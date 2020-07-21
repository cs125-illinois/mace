import React, { Component, ReactElement, createContext, ReactNode, useContext } from "react"
import PropTypes from "prop-types"

import { IAceEditor } from "react-ace/lib/types"
import ReconnectingWebSocket from "reconnecting-websocket"
import { PingWS, filterPingPongMessages } from "@cs125/pingpongws"

import { v4 as uuidv4 } from "uuid"
import queryString from "query-string"

import { Delta, SaveMessage, ConnectionQuery, UpdateMessage, GetMessage, Cursor } from "../types"

import { String } from "runtypes"
const VERSION = String.check(process.env.npm_package_version)
const COMMIT = String.check(process.env.GIT_COMMIT)

export interface MaceContext {
  available: boolean
  connected: boolean
  register: (editorId: string, updater: UpdateFunction) => void
  save: (message: SaveMessage, useServer?: boolean) => void
}
export const MaceContext = createContext<MaceContext>({
  available: false,
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
      version: VERSION,
      commit: COMMIT,
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
    return (
      <MaceContext.Provider value={{ available: true, connected, register, save }}>
        {this.props.children}
      </MaceContext.Provider>
    )
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
