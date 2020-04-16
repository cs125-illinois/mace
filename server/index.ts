import _ from "lodash"

import Koa from "koa"
import Router from "koa-router"
import bodyParser from "koa-bodyparser"
import cors from "@koa/cors"
import websocket from "koa-easy-ws"

import WebSocket from "ws"
import { SaveMessage, ConnectionQuery, UpdateMessage, ClientMessages, GetMessage } from "mace-types"

import { v4 as uuidv4 } from "uuid"

const router = new Router<{}, { ws: () => Promise<WebSocket> }>()
const websocketsForClient: Record<string, Array<WebSocket>> = {}

const savedEditors: Record<string, Record<string, string>> = {}

function doUpdate(clientId: string, editorId: string, value: string, saveId: string = uuidv4()): void {
  const update = UpdateMessage.check({
    type: "update",
    editorId,
    saveId,
    value,
  })
  Promise.all(
    _.forEach(websocketsForClient[clientId], (ws) => {
      ws.send(JSON.stringify(update))
    })
  )
}

function doSave(clientId: string, message: SaveMessage): void {
  const { editorId, saveId, value } = message
  savedEditors[clientId][editorId] = value
  doUpdate(clientId, editorId, value, saveId)
}

function doGet(clientId: string, message: GetMessage): void {
  const { editorId } = message
  let value: string | undefined
  try {
    value = savedEditors[clientId][editorId]
  } catch (err) {
    console.log(err)
  }
  if (value) {
    doUpdate(clientId, editorId, value)
  }
}

function terminate(clientId: string, ws: WebSocket): void {
  try {
    ws.terminate()
  } catch (err) {}
  _.remove(websocketsForClient[clientId], ws)
  if (websocketsForClient[clientId].length === 0) {
    delete websocketsForClient[clientId]
  }
}

router.get("/", async (ctx) => {
  if (!ctx.ws) {
    return ctx.throw(404)
  }
  const { browserId: clientId } = ConnectionQuery.check(ctx.request.query)

  if (!(clientId in savedEditors)) {
    savedEditors[clientId] = {}
  }

  const ws = await ctx.ws()
  if (websocketsForClient[clientId]) {
    websocketsForClient[clientId].push(ws)
  } else {
    websocketsForClient[clientId] = [ws]
  }

  ws.on("message", (data) => {
    ClientMessages.match(
      (save) => doSave(clientId, save),
      (get) => doGet(clientId, get)
    )(JSON.parse(data.toString()))
  })
  ws.on("pong", () => {
    console.log("pong")
  })
  ws.on("close", () => {
    terminate(clientId, ws)
  })
  ws.on("error", () => {
    terminate(clientId, ws)
  })
  ws.on("unexpected-response", () => {
    terminate(clientId, ws)
  })
})

const app = new Koa()
const port = process.env.BACKEND_PORT ? parseInt(process.env.BACKEND_PORT) : 8888
app.use(cors()).use(bodyParser()).use(websocket()).use(router.routes()).use(router.allowedMethods()).listen(port)

process.on("uncaughtException", (err) => {
  console.error(err)
})
