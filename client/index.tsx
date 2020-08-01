import React, { createContext, ReactNode, useState, useRef, useEffect, useCallback, useContext } from "react"
import PropTypes from "prop-types"

import { Ace } from "ace-builds"
import ReconnectingWebSocket from "reconnecting-websocket"
import { PingWS, filterPingPongMessages } from "@cs125/pingpongws"

import { EventEmitter } from "events"

import { v4 as uuidv4 } from "uuid"
import queryString from "query-string"
import { debounce } from "throttle-debounce"

import { AceRecord, stream, applyAceRecord, getComplete, applyComplete } from "@cs125/monace"

import { ConnectionQuery, ServerMessages, UpdateMessage, GetMessage } from "../types"

import { String } from "runtypes"
const VERSION = String.check(process.env.npm_package_version)
const COMMIT = String.check(process.env.GIT_COMMIT)

export interface RegisterOptions {
  useServer?: boolean
  autoSave?: boolean
  autoSaveDelay?: number
  streaming?: boolean
  onSaveStarted?: () => void
  onSaveCompleted?: () => void
  onGetCompleted?: () => void
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
      const values = [...new Set(Object.values(editors.current))]
      values.forEach((id) =>
        connection.current?.send(JSON.stringify(GetMessage.check({ type: "get", id, local: true })))
      )
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
        if (UpdateMessage.guard(response) || GetMessage.guard(response)) {
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
    const autoSave = options?.autoSave !== undefined ? options.autoSave : true
    const autoSaveDelay = options?.autoSaveDelay !== undefined ? options.autoSaveDelay : 1024
    const streaming = options?.streaming !== undefined ? options.streaming : false

    let records: AceRecord[] = []
    let isEnabled = true
    let saving: string | undefined
    let last: string | undefined

    const save: SaveEditor = (force = false) => {
      if (!isEnabled) {
        return
      }
      if (records.length === 0 && !force) {
        return
      }
      const save = uuidv4()
      if (useServer) {
        saving = save
      }

      const toSave = streaming ? [...records] : [...records, getComplete(editor)]
      records = []

      const updateMessage = UpdateMessage.check({
        type: "update",
        id,
        view,
        save,
        local: true,
        streaming,
        focused: editor.isFocused(),
        records: toSave,
      })
      const updateMessageString = JSON.stringify(updateMessage)

      messager.current.emit(id, updateMessage)
      localStorage.setItem(`mace:${id}`, updateMessageString)
      useServer && connection.current?.send(updateMessageString)
      useServer && options?.onSaveStarted && options.onSaveStarted()
    }
    const autoSaver = debounce(autoSaveDelay, save)

    const messageListener = (record: AceRecord) => {
      if (!isEnabled) {
        return
      }
      records.push(record)
      if (streaming) {
        save()
      } else {
        autoSave && autoSaver()
      }
    }
    const { stop: stopStream, pause, restart } = stream(editor, messageListener)

    const eventListener = (message: UpdateMessage | GetMessage) => {
      if (GetMessage.guard(message)) {
        !message.local && message.id === id && options?.onGetCompleted && options.onGetCompleted()
        return
      }
      const update = UpdateMessage.check(message)
      if (useServer && update.view === view && update.save === saving && !update.local) {
        useServer && options?.onSaveCompleted && options.onSaveCompleted()
        saving = undefined
        return
      }
      if (!isEnabled || update.view === view || update.records.length === 0 || update.save === last) {
        console.log("Duplicate")
        return
      }
      last = update.save
      if (!streaming) {
        const record = update.records[update.records.length - 1]
        if (record.type !== "complete") {
          return
        }
        pause()
        record && applyComplete(editor, record, editor.isFocused() && !record.focused)
        restart()
      } else {
        pause()
        for (const record of update.records) {
          applyAceRecord(editor, record)
        }
        restart()
      }
    }
    messager.current.addListener(id, eventListener)

    const enable = (enabled: boolean) => {
      !enabled && save()
      isEnabled = enabled
    }
    const stop: StopEditor = () => {
      stopStream()
      messager.current.removeListener(id, eventListener)
      delete editors.current[id]
    }

    console.log("Blah")
    useServer && connection.current?.send(JSON.stringify(GetMessage.check({ type: "get", id, local: true })))

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
