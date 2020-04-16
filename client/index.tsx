import React, { Component, ReactElement, createContext, ReactNode } from "react"
import PropTypes from "prop-types"

import AceEditor, { IAceOptions } from "react-ace"
import ReconnectingWebSocket from "reconnecting-websocket"

import { v4 as uuidv4 } from "uuid"
import queryString from "query-string"

import { Delta, SaveMessage, ConnectionQuery, ServerMessages, UpdateMessage, GetMessage } from "mace-types"

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
  server: string
  children: ReactNode
}
interface MaceProviderState {
  connected: boolean
}
export type UpdateFunction = (update: UpdateMessage) => void

export class MaceProvider extends Component<MaceProviderProps, MaceProviderState> {
  private connection: ReconnectingWebSocket
  private editorUpdaters: Record<string, Array<UpdateFunction>> = {}

  private browserId: string

  constructor(props: MaceProviderProps) {
    super(props)

    this.browserId = localStorage.getItem("mace") || uuidv4()
    localStorage.setItem("mace", this.browserId)

    this.state = { connected: false }

    const connectionQuery = ConnectionQuery.check({
      browserId: this.browserId,
    })
    this.connection = new ReconnectingWebSocket(`${props.server}?${queryString.stringify(connectionQuery)}`)
  }

  componentDidMount(): void {
    this.connection.onopen = (): void => {
      this.setState({ connected: true })
      Object.keys(this.editorUpdaters).forEach((editorId) => {
        console.log(editorId)
        const message = GetMessage.check({ type: "get", editorId })
        this.connection.send(JSON.stringify(message))
      })
    }
    this.connection.onclose = (): void => {
      this.setState({ connected: false })
    }
    this.connection.onmessage = ({ data }): void => {
      ServerMessages.match((update) => this.update(update))(JSON.parse(data))
    }
  }

  update = (update: UpdateMessage): void => {
    const { editorId } = update
    if (!(editorId in this.editorUpdaters)) {
      console.debug(`no updater for ${editorId}`)
      return
    }
    try {
      this.editorUpdaters[editorId].forEach((updater) => updater(update))
    } catch (err) {
      console.error(err)
    }
  }

  componentWillUnmount(): void {
    try {
      this.connection.close()
    } catch (err) {}
  }

  register = (editorId: string, updater: UpdateFunction): void => {
    if (!(editorId in this.editorUpdaters)) {
      this.editorUpdaters[editorId] = []
    }
    this.editorUpdaters[editorId].push(updater)
  }

  save = (message: SaveMessage): void => {
    if (!this.state.connected) {
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
  children: string
  onExternalUpdate?: (value: string) => void
}
export class MaceEditor extends Component<MaceProps> {
  static contextType = MaceContext
  declare context: React.ContextType<typeof MaceContext>

  static propTypes = {
    id: PropTypes.string,
    children: PropTypes.string.isRequired,
  }

  private lastSaveID: string | undefined
  private value: string
  private deltas: Array<Delta> = []

  constructor(props: MaceProps, context: MaceContext) {
    super(props, context)
    this.value = props.children
    context.register(this.props.id, this.update)
  }

  update: UpdateFunction = (update: UpdateMessage) => {
    if (update.saveId !== this.lastSaveID && this.props.onExternalUpdate) {
      this.props.onExternalUpdate(update.value)
    }
  }

  save = (): void => {
    this.lastSaveID = uuidv4()
    const message = {
      type: "save",
      editorId: this.props.id,
      saveId: this.lastSaveID,
      value: this.value,
      deltas: [...this.deltas],
    } as SaveMessage
    this.deltas = []
    this.context.save(message)
  }

  render(): ReactElement {
    const { id, children, onChange, ...aceProps } = this.props // eslint-disable-line @typescript-eslint/no-unused-vars
    return (
      <AceEditor
        onChange={(value, delta): void => {
          this.value = value
          delta = Delta.check(delta)
          this.deltas.push(delta)
          try {
            onChange(value, delta)
          } catch (err) {
            console.log(err)
          }
        }}
        {...aceProps}
      />
    )
  }
}
