import React, { Component, ReactElement, createContext, ReactNode, createRef, useContext } from "react"
import PropTypes from "prop-types"

import AceEditor, { IAceOptions } from "react-ace"
import { IAceEditor } from "react-ace/lib/types"
import ReconnectingWebSocket from "reconnecting-websocket"
import { PingWS, filterPingPongMessages } from "@cs125/pingpongws"

import { v4 as uuidv4 } from "uuid"
import queryString from "query-string"

import { Delta, SaveMessage, ConnectionQuery, UpdateMessage, GetMessage, Cursor as MaceCursor, Cursor } from "../types"

export interface MaceContext {
  connected: boolean
  register: (editorId: string, updater: UpdateFunction) => void
  save: (message: SaveMessage, useServer?: boolean) => void
}
export const MaceContext = createContext<MaceContext>({
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

type UpdateFunction = (update: UpdateMessage) => void

export class MaceProvider extends Component<MaceProviderProps, MaceProviderState> {
  private connection: ReconnectingWebSocket | undefined

  private editorUpdaters: Record<string, Array<UpdateFunction>> = {}

  private browserId: string

  constructor(props: MaceProviderProps) {
    super(props)

    this.browserId = localStorage.getItem("mace") || uuidv4()
    localStorage.setItem("mace", this.browserId)

    this.state = { connected: this.props.server === undefined }
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

    this.connection = PingWS(
      new ReconnectingWebSocket(`${this.props.server}?${queryString.stringify(connectionQuery)}`)
    )
    this.connection.addEventListener("open", () => {
      this.setState({ connected: true })
      Object.keys(this.editorUpdaters).forEach((editorId) => {
        const message = GetMessage.check({ type: "get", editorId })
        this.connection?.send(JSON.stringify(message))
      })
    })
    this.connection.addEventListener("close", () => {
      this.setState({ connected: false })
    })
    this.connection.addEventListener(
      "message",
      filterPingPongMessages(({ data }) => {
        const message = JSON.parse(data)
        if (UpdateMessage.guard(message)) {
          this.update(message)
        }
      })
    )
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

  save = (message: SaveMessage, useServer = true): void => {
    if (!this.props.server || !useServer) {
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

export interface MaceArguments {
  editor: IAceEditor
  id: string
  context: MaceContext
  saveCompleted?: (update: UpdateMessage) => void
  onUpdate?: (value: string, delta: { [key: string]: unknown }) => void
  onSelectionChange?: (value: string, event: unknown) => void
  onExternalUpdate?: (update: UpdateMessage) => void
}

export const cursorsAreEqual: (first: Cursor, second: Cursor) => boolean = (first: Cursor, second: Cursor) => {
  return first.row === second.row && first.column === second.column
}

export const mace: (args: MaceArguments) => (useServer?: boolean) => void = ({ editor, id, context, ...callbacks }) => {
  let lastSaveID: string | undefined

  let deltas: Array<Delta> = []
  let quiet = false
  const changeListener = (delta: { [key: string]: unknown }) => {
    deltas.push(Delta.check({ ...delta, timestamp: new Date().toISOString() }))
    !quiet && callbacks.onUpdate && callbacks.onUpdate(editor.getValue(), delta)
  }
  editor.session.addEventListener("change", changeListener)
  const selectionChangeListener = (event: unknown) => {
    !quiet && callbacks.onSelectionChange && callbacks.onSelectionChange(editor.getValue(), event)
  }
  editor.addEventListener("changeSelection", selectionChangeListener)

  context.register(id, (update: UpdateMessage) => {
    if (update.saveId === lastSaveID) {
      callbacks.saveCompleted && callbacks.saveCompleted(update)
    } else {
      quiet = true
      const previousPosition = editor.session.selection.toJSON()
      editor.setValue(update.value)
      editor.session.selection.fromJSON(previousPosition)
      const ourCursor = editor.selection.getCursor()
      if (Cursor.guard(ourCursor) && Cursor.guard(update.cursor) && !cursorsAreEqual(ourCursor, update.cursor)) {
        try {
          editor.moveCursorTo(update.cursor.row, update.cursor.column)
        } catch (err) {}
      }
      quiet = false
      callbacks.onExternalUpdate && callbacks.onExternalUpdate(update)
    }
  })

  return (useServer = true) => {
    lastSaveID = uuidv4()
    const message = {
      type: "save",
      editorId: id,
      saveId: lastSaveID,
      value: editor.getValue(),
      deltas,
      cursor: Cursor.check(editor.selection.getCursor()),
    } as SaveMessage
    deltas = []
    context.save(message, useServer)
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
      try {
        this.aceRef.current?.editor.moveCursorTo(theirCursor.row, theirCursor.column)
      } catch (err) {}
      return true
    } else {
      return false
    }
  }

  private cursorTimer: NodeJS.Timeout | undefined
  update: UpdateFunction = (update: UpdateMessage) => {
    if (update.saveId !== this.lastSaveID && this.props.onExternalUpdate) {
      this.props.onExternalUpdate(update)
      if (this.cursorTimer) {
        clearTimeout(this.cursorTimer)
      }
      if (!this.syncCursor(update.cursor)) {
        this.cursorTimer = setTimeout(() => {
          this.syncCursor(update.cursor)
        }, 10)
      }
    } else if (update.saveId === this.lastSaveID && this.props.onSave) {
      this.props.onSave(update.value)
    }
  }

  setValue = (value: string): void => {
    this.aceRef?.current?.editor.setValue(value)
  }

  save = (): void => {
    const cursor = MaceCursor.check(this.cursor || this.aceRef.current?.editor.selection.getCursor())
    this.lastSaveID = uuidv4()
    const message = {
      type: "save",
      editorId: this.props.id,
      saveId: this.lastSaveID,
      value: this.value,
      deltas: [...this.deltas],
      cursor,
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

export const useMace = (): MaceContext => {
  return useContext(MaceContext)
}
export const withMaceConnected = (): boolean => {
  const { connected } = useContext(MaceContext)
  return connected
}
interface WithMaceConnectedProps {
  children: (connected: boolean) => JSX.Element | null
}
export const WithMaceConnected: React.FC<WithMaceConnectedProps> = ({ children }) => {
  return children(withMaceConnected())
}
WithMaceConnected.propTypes = {
  children: PropTypes.func.isRequired,
}
