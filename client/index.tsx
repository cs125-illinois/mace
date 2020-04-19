import React, { Component, ReactElement, createContext, ReactNode, createRef } from "react"
import PropTypes from "prop-types"

import AceEditor, { IAceOptions } from "react-ace"
import ReconnectingWebSocket from "reconnecting-websocket"

import { v4 as uuidv4 } from "uuid"
import queryString from "query-string"

import { Delta, SaveMessage, ConnectionQuery, UpdateMessage, GetMessage, Cursor as MaceCursor, Cursor } from "../types"

interface MaceContext {
  connected: boolean
  register: (editorId: string, updater: UpdateFunction) => void
  save: (message: SaveMessage) => void
}
const MaceContext = createContext<MaceContext>({
  connected: false,
  register: (): string => {
    throw new Error("Mace provider not set")
  },
  save: () => {
    throw new Error("Mace provider not set")
  },
})

interface MaceProviderProps {
  server?: string
  googleToken?: string
  children: ReactNode
}
interface MaceProviderState {
  connected: boolean
}

export type UpdateFunction = (update: UpdateMessage) => void

export class MaceProvider extends Component<MaceProviderProps, MaceProviderState> {
  private connection: ReconnectingWebSocket | undefined
  private editorUpdaters: Record<string, Array<UpdateFunction>> = {}

  private browserId: string

  constructor(props: MaceProviderProps) {
    super(props)

    this.browserId = localStorage.getItem("mace") || uuidv4()
    localStorage.setItem("mace", this.browserId)

    this.state = { connected: false }
  }

  connect = (): void => {
    if (this.connection) {
      this.connection.close()
    }
    if (!this.props.server) {
      return
    }
    const connectionQuery = ConnectionQuery.check({
      browserId: this.browserId,
      googleToken: this.props.googleToken,
    })

    this.connection = new ReconnectingWebSocket(`${this.props.server}?${queryString.stringify(connectionQuery)}`)
    this.connection.onopen = (): void => {
      this.setState({ connected: true })
      Object.keys(this.editorUpdaters).forEach((editorId) => {
        const message = GetMessage.check({ type: "get", editorId })
        this.connection?.send(JSON.stringify(message))
      })
    }
    this.connection.onclose = (): void => {
      this.setState({ connected: false })
    }
    this.connection.onmessage = ({ data }): void => {
      const message = JSON.parse(data)
      if (UpdateMessage.guard(message)) {
        this.update(message)
      } else {
        console.error(`bad message: ${data}`)
      }
    }
  }

  componentDidMount(): void {
    this.connect()
  }

  componentDidUpdate(prevProps: MaceProviderProps): void {
    if (prevProps.googleToken === this.props.googleToken) {
      return
    }
    this.connect()
  }

  update = (update: UpdateMessage): void => {
    const { editorId } = update
    if (!(editorId in this.editorUpdaters)) {
      console.debug(`no updater for ${editorId}`)
      return
    }
    this.editorUpdaters[editorId].forEach((updater) => updater(update))
    localStorage.setItem(`mace:${editorId}`, JSON.stringify(update))
  }

  componentWillUnmount(): void {
    try {
      this.connection?.close()
    } catch (err) {}
  }

  register = (editorId: string, updater: UpdateFunction): void => {
    if (!(editorId in this.editorUpdaters)) {
      this.editorUpdaters[editorId] = []
    }
    this.editorUpdaters[editorId].push(updater)
    try {
      const update = UpdateMessage.check(JSON.parse(localStorage.getItem(`mace:${editorId}`) as string))
      if (update) {
        updater(update)
      }
    } catch (err) {}
  }

  save = (message: SaveMessage): void => {
    if (!this.props.server) {
      const update = UpdateMessage.check({
        type: "update",
        editorId: message.editorId,
        saveId: message.saveId,
        value: message.value,
        cursor: message.cursor,
      })
      this.update(update)
      return
    }
    if (!this.connection || !this.state.connected) {
      throw new Error("mace server not connected")
    }
    SaveMessage.check(message)
    this.connection.send(JSON.stringify(message))
  }

  render(): ReactElement {
    const { connected } = this.state
    const { register, save } = this
    return <MaceContext.Provider value={{ connected, register, save }}>{this.props.children}</MaceContext.Provider>
  }
}

export interface MaceProps extends IAceOptions {
  id: string
  onExternalUpdate?: (update: UpdateMessage) => void
  onSave?: (value: string) => void
}
export class MaceEditor extends Component<MaceProps> {
  static contextType = MaceContext
  declare context: React.ContextType<typeof MaceContext>

  static propTypes = {
    id: PropTypes.string,
  }

  private aceRef = createRef<AceEditor>()

  private lastSaveID: string | undefined
  private value: string
  private deltas: Array<Delta> = []
  private cursor: MaceCursor | undefined

  constructor(props: MaceProps, context: MaceContext) {
    super(props, context)
    this.value = props.value
    context.register(this.props.id, this.update)
  }

  componentWillUnmount(): void {
    if (this.cursorTimer) {
      clearTimeout(this.cursorTimer)
    }
  }

  syncCursor = (theirCursor: Cursor): boolean => {
    const ourCursor = this.aceRef.current?.editor.selection.getCursor()
    if (
      Cursor.guard(ourCursor) &&
      Cursor.guard(theirCursor) &&
      ourCursor.row === theirCursor.row &&
      ourCursor.column === theirCursor.column
    ) {
      return true
    }
    if (this.aceRef.current?.editor?.getValue() === this.props.value) {
      this.aceRef.current?.editor.moveCursorTo(theirCursor.row, theirCursor.column)
      return true
    } else {
      return false
    }
  }

  private cursorTimer: NodeJS.Timeout | undefined
  update: UpdateFunction = (update: UpdateMessage) => {
    if (update.saveId !== this.lastSaveID && this.props.onExternalUpdate) {
      this.props.onExternalUpdate(update)
    } else if (update.saveId === this.lastSaveID && this.props.onSave) {
      this.props.onSave(update.value)
    }
    if (this.cursorTimer) {
      clearTimeout(this.cursorTimer)
    }
    if (!this.syncCursor(update.cursor)) {
      this.cursorTimer = setTimeout(() => {
        this.syncCursor(update.cursor)
      }, 10)
    }
  }

  setValue = (value: string): void => {
    this.aceRef?.current?.editor.setValue(value)
  }

  save = (): void => {
    this.lastSaveID = uuidv4()
    const message = {
      type: "save",
      editorId: this.props.id,
      saveId: this.lastSaveID,
      value: this.value,
      deltas: [...this.deltas],
      cursor: this.cursor,
    } as SaveMessage
    this.deltas = []
    this.context.save(message)
  }

  render(): ReactElement {
    const { id, children, onChange, onCursorChange, ...aceProps } = this.props // eslint-disable-line @typescript-eslint/no-unused-vars

    return (
      <AceEditor
        ref={this.aceRef}
        onChange={(value, delta): void => {
          this.value = value
          this.deltas.push(Delta.check({ ...delta, timestamp: new Date().toISOString() }))
          if (onChange) {
            onChange(value, delta)
          }
        }}
        onCursorChange={(): void => {
          this.cursor = MaceCursor.check(this.aceRef.current?.editor.selection.getCursor())
          if (onCursorChange) {
            onCursorChange()
          }
        }}
        {...aceProps}
      />
    )
  }
}
