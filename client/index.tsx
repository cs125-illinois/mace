import React, { createContext, ReactNode, useState, useRef, useEffect, useCallback, useContext } from "react"
import PropTypes from "prop-types"

import { Ace } from "ace-builds"
import ReconnectingWebSocket from "reconnecting-websocket"
import { PingWS, filterPingPongMessages } from "@cs125/pingpongws"

import { EventEmitter } from "events"

import { v4 as uuidv4 } from "uuid"
import queryString from "query-string"

import { AceRecord, stream, getComplete, applyAceRecord } from "@cs125/monace"

import { ConnectionQuery, ServerMessages, UpdateMessage, GetMessage } from "../types"

import { String, Array } from "runtypes"
const VERSION = String.check(process.env.npm_package_version)
const COMMIT = String.check(process.env.GIT_COMMIT)

export interface RegisterOptions {
  useServer?: boolean
}
export type RegisterRequest = {
  id: string
  editor: Ace.Editor
  options?: RegisterOptions
}

export type SaveEditor = (force?: boolean) => void
export type EnableEditor = (enabled: boolean) => void
export type StopEditor = () => void
export type RegisterResponse = {
  save: SaveEditor
  enable: EnableEditor
  stop: StopEditor
}

export interface MaceContext {
  available: boolean
  connected: boolean
  register: (request: RegisterRequest) => RegisterResponse
}
export const MaceContext = createContext<MaceContext>({
  available: false,
  connected: false,
  register: () => {
    throw new Error("Mace provider not set")
  },
})

interface MaceProviderProps {
  server?: string
  googleToken?: string
  children: ReactNode
}

export const MaceProvider: React.FC<MaceProviderProps> = ({ server, googleToken, children }) => {
  const [connected, setConnected] = useState(false)

  const client = useRef<string>((typeof window !== "undefined" && localStorage.getItem("mace:id")) || uuidv4())
  const connection = useRef<ReconnectingWebSocket | undefined>(undefined)
  const messager = useRef(new EventEmitter())
  const editors = useRef<Record<string, string>>({})

  useEffect(() => {
    localStorage.setItem("mace:id", client.current)
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      messager.current?.removeAllListeners()
    }
  }, [])

  useEffect(() => {
    connection.current?.close()

    const connectionQuery = ConnectionQuery.check({
      client: client.current,
      version: VERSION,
      commit: COMMIT,
      googleToken,
    })
    connection.current = PingWS(
      new ReconnectingWebSocket(`${server}?${queryString.stringify(connectionQuery)}`, [], { startClosed: true })
    )

    connection.current.addEventListener("open", () => {
      setConnected(true)
      Object.values(editors.current).forEach((id) => {
        connection.current?.send(JSON.stringify(GetMessage.check({ type: "get", id })))
      })
    })
    connection.current.addEventListener("close", () => setConnected(false))

    connection.current.addEventListener(
      "message",
      filterPingPongMessages(({ data }) => {
        const response = JSON.parse(data)
        if (!ServerMessages.guard(response)) {
          console.error(`Bad message: ${JSON.stringify(response, null, 2)}`)
          return
        }
        if (UpdateMessage.guard(response)) {
          messager.current.emit(response.id, response)
        }
      })
    )

    connection.current.reconnect()
    return (): void => connection.current?.close()
  }, [server, googleToken])

  const register = useCallback((request: RegisterRequest) => {
    const { id, editor, options } = request
    const view = uuidv4()
    editors.current[view] = id
    const useServer = options?.useServer !== undefined ? options.useServer : true

    let records: AceRecord[] = []
    let quiet = false
    let isEnabled = true

    const stopStream = stream(editor, (record: AceRecord) => {
      !quiet && isEnabled && records.push(record)
    })
    const aceListener = (update: UpdateMessage) => {
      if (!isEnabled || update.view === view) {
        return
      }
      const record = Array(AceRecord).guard(update.records) ? update.records.pop() : update.records
      quiet = true
      record && applyAceRecord(editor, record)
      quiet = false
    }
    messager.current.addListener(id, aceListener)

    const save: SaveEditor = (force = false) => {
      if (!isEnabled) {
        return
      }
      if (records.length === 0 && !force) {
        return
      }
      const updateMessage = UpdateMessage.check({
        type: "update",
        id,
        view,
        save: uuidv4(),
        records: [...records, getComplete(editor)],
      })

      messager.current.emit(id, updateMessage)
      localStorage.setItem(`mace:${id}`, JSON.stringify(updateMessage))
      useServer && connection.current?.send(JSON.stringify(updateMessage))

      records = []
    }
    const enable = (enabled: boolean) => {
      !enabled && save()
      isEnabled = enabled
    }
    const stop: StopEditor = () => {
      stopStream()
      messager.current.removeListener(id, aceListener)
      delete editors.current[id]
    }

    useServer && connection.current?.send(JSON.stringify(GetMessage.check({ type: "get", id })))

    return { save, enable, stop }
  }, [])

  return <MaceContext.Provider value={{ available: true, connected, register }}>{children}</MaceContext.Provider>
}

MaceProvider.propTypes = {
  server: PropTypes.string.isRequired,
  googleToken: PropTypes.string,
  children: PropTypes.node.isRequired,
}

export const useMace = (): MaceContext => {
  return useContext(MaceContext)
}
