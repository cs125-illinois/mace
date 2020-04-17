import _ from "lodash"

import Koa from "koa"
import Router from "koa-router"
import bodyParser from "koa-bodyparser"
import cors from "@koa/cors"
import websocket from "koa-easy-ws"

import { MongoClient as mongo } from "mongodb"

import WebSocket from "ws"
import { SaveMessage, ConnectionQuery, UpdateMessage, ClientMessages, GetMessage } from "mace-types"

import { v4 as uuidv4 } from "uuid"

const app = new Koa()
const router = new Router<{}, { ws: () => Promise<WebSocket> }>()

const client = mongo.connect(process.env.MONGODB as string, { useNewUrlParser: true, useUnifiedTopology: true })
const maceCollection = client.then((c) =>
  c.db(process.env.MONGODB_DATABASE).collection(process.env.MONGODB_COLLECTION || "mace")
)

const websocketsForClient: Record<string, Array<WebSocket>> = {}

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

async function doSave(clientId: string, message: SaveMessage): Promise<void> {
  const { editorId, saveId, value, deltas } = message

  await (await maceCollection).insertOne({
    saved: new Date(),
    clientId,
    editorId,
    saveId,
    value,
    deltas,
  })

  doUpdate(clientId, editorId, value, saveId)
}

async function doGet(clientId: string, message: GetMessage): Promise<void> {
  const { editorId } = message
  let value: string | undefined
  try {
    value = (
      await (await maceCollection)
        .find({
          clientId,
          editorId,
        })
        .sort({ saved: -1 })
        .limit(1)
        .toArray()
    )[0].value
  } catch (err) {}
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

maceCollection.then(async (c) => {
  console.log(`Restart (${process.env.GIT_COMMIT})`)

  await c.createIndex({ clientId: 1, editorId: 1, saved: 1 })

  const port = process.env.BACKEND_PORT ? parseInt(process.env.BACKEND_PORT) : 8888
  app.use(cors()).use(bodyParser()).use(websocket()).use(router.routes()).use(router.allowedMethods()).listen(port)
})

process.on("uncaughtException", (err) => {
  console.error(err)
})
