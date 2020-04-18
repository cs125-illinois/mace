import _ from "lodash"

import Koa from "koa"
import Router from "koa-router"
import bodyParser from "koa-bodyparser"
import cors from "@koa/cors"
import websocket from "koa-easy-ws"

import { MongoClient as mongo } from "mongodb"
import mongodbUri from "mongodb-uri"

import { OAuth2Client } from "google-auth-library"

import WebSocket from "ws"
import { SaveMessage, ConnectionQuery, UpdateMessage, GetMessage, ServerStatus } from "../types"

import { v4 as uuidv4 } from "uuid"
import { Array, String } from "runtypes"

const app = new Koa()
const router = new Router<{}, { ws: () => Promise<WebSocket> }>()
const clientIDs =
  process.env.GOOGLE_CLIENT_IDS && Array(String).check(process.env.GOOGLE_CLIENT_IDS?.split(",").map((s) => s.trim()))
const googleClient = clientIDs && clientIDs.length > 0 && new OAuth2Client(clientIDs[0])

const { database } = mongodbUri.parse(process.env.MONGODB as string)
const client = mongo.connect(process.env.MONGODB as string, { useNewUrlParser: true, useUnifiedTopology: true })
const maceCollection = client.then((c) => c.db(database).collection(process.env.MONGODB_COLLECTION || "mace"))

const serverStatus: ServerStatus = ServerStatus.check({
  version: process.env.npm_package_version,
  commit: process.env.GIT_COMMIT,
  counts: {
    client: 0,
    save: 0,
    get: 0,
  },
})
const websocketsForClient: Record<string, WebSocket[]> = {}

async function doUpdate(clientId: string, editorId: string, value: string, saveId: string = uuidv4()): Promise<void> {
  const update = UpdateMessage.check({
    type: "update",
    editorId,
    saveId,
    value,
  })
  await Promise.all(
    _.forEach(websocketsForClient[clientId], (ws) => {
      ws.send(JSON.stringify(update))
    })
  )
}

async function doSave(clientId: string, browserId: string, message: SaveMessage): Promise<void> {
  const { editorId, saveId, value, deltas } = message
  await (await maceCollection).insertOne({
    saved: new Date(),
    clientId,
    editorId,
    saveId,
    value,
    deltas,
  })
  if (browserId !== clientId) {
    await (await maceCollection).insertOne({
      saved: new Date(),
      clientId: browserId,
      editorId,
      saveId,
      value,
      deltas,
    })
  }
  await doUpdate(clientId, editorId, value, saveId)
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
    await doUpdate(clientId, editorId, value)
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
  serverStatus.counts.client = _.keys(websocketsForClient).length
}

router.get("/", async (ctx) => {
  if (!ctx.ws) {
    ctx.body = serverStatus
    return
  }
  const connectionQuery = ConnectionQuery.check(ctx.request.query)
  const { browserId } = connectionQuery
  const { googleToken: idToken } = connectionQuery
  let clientId = browserId

  if (idToken && googleClient) {
    try {
      const email = (
        await googleClient.verifyIdToken({
          idToken,
          audience: clientIDs || [],
        })
      ).getPayload()?.email
      if (email) {
        clientId = email
      }
    } catch (err) {}
  }
  clientId = `${ctx.headers.origin}/${clientId}`
  const fullBrowserId = `${ctx.headers.origin}/${browserId}`

  const ws = await ctx.ws()
  if (websocketsForClient[clientId]) {
    websocketsForClient[clientId].push(ws)
  } else {
    websocketsForClient[clientId] = [ws]
  }

  serverStatus.counts.client = _.keys(websocketsForClient).length

  ws.on("message", async (data) => {
    const message = JSON.parse(data.toString())
    if (SaveMessage.guard(message)) {
      await doSave(clientId, fullBrowserId, message)
      serverStatus.counts.save++
    } else if (GetMessage.guard(message)) {
      serverStatus.counts.get++
      await doGet(clientId, message)
    } else {
      console.error(`Bad message: ${JSON.stringify(message, null, 2)}`)
    }
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

  const validDomains = process.env.VALID_DOMAINS && process.env.VALID_DOMAINS.split(",").map((s) => s.trim)
  const port = process.env.BACKEND_PORT ? parseInt(process.env.BACKEND_PORT) : 8888
  app
    .use(
      cors({
        origin: (ctx) => {
          if (validDomains && validDomains.includes(ctx.headers.origin)) {
            return false
          }
          return ctx.headers.origin
        },
      })
    )
    .use(bodyParser())
    .use(websocket())
    .use(router.routes())
    .use(router.allowedMethods())
    .listen(port)
})

process.on("uncaughtException", (err) => {
  console.error(err)
})
