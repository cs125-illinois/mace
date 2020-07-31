import Koa from "koa"
import Router from "koa-router"
import bodyParser from "koa-bodyparser"
import cors from "@koa/cors"
import websocket from "koa-easy-ws"

import { MongoClient as mongo } from "mongodb"
import mongodbUri from "mongodb-uri"

import { OAuth2Client } from "google-auth-library"

import WebSocket from "ws"
import { PongWS, filterPingPongMessages } from "@cs125/pingpongws"

import { EventEmitter } from "events"

import { ConnectionQuery, GetMessage, ServerStatus, Versions, ClientMessages, UpdateMessage } from "../types"

import { Array, String } from "runtypes"

const VERSIONS = {
  commit: String.check(process.env.GIT_COMMIT),
  server: String.check(process.env.npm_package_version),
}

const app = new Koa()
const router = new Router<Record<string, unknown>, { ws: () => Promise<WebSocket> }>()
const googleClientIDs =
  process.env.GOOGLE_CLIENT_IDS && Array(String).check(process.env.GOOGLE_CLIENT_IDS?.split(",").map((s) => s.trim()))
const googleClient = googleClientIDs && googleClientIDs.length > 0 && new OAuth2Client(googleClientIDs[0])

const { database } = mongodbUri.parse(process.env.MONGODB as string)
const client = mongo.connect(process.env.MONGODB as string, { useNewUrlParser: true, useUnifiedTopology: true })
const maceCollection = client.then((c) => c.db(database).collection(process.env.MONGODB_COLLECTION || "mace"))

const serverStatus: ServerStatus = ServerStatus.check({
  started: new Date().toISOString(),
  version: process.env.npm_package_version,
  commit: process.env.GIT_COMMIT,
  counts: {
    client: 0,
    update: 0,
    get: 0,
  },
  googleClientIDs,
})
/*
const websocketsForClient: Record<string, WebSocket[]> = {}

function websocketIdFromClientId(clientId: ClientId): string {
  return `${clientId.origin}/${clientId.email || clientId.browserId}`
}

async function doUpdate(clientId: ClientId, saveMessage: SaveMessage): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { type, deltas, ...savedContent } = saveMessage

  const update = UpdateMessage.check({
    type: "update",
    ...savedContent,
  })
  const websocketId = websocketIdFromClientId(clientId)
  await Promise.all(
    _.forEach(websocketsForClient[websocketId], (ws) => {
      ws.send(JSON.stringify(update))
    })
  )
}

async function doSave(clientId: ClientId, saveMessage: SaveMessage, versions: Versions): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { type, ...savedContent } = saveMessage

  await (await maceCollection).insertOne({
    timestamp: new Date(),
    ...clientId,
    saved: savedContent,
    versions,
  })
  await doUpdate(clientId, saveMessage)
}

async function doGet(clientId: ClientId, getMessage: GetMessage): Promise<void> {
  try {
    const { editorId } = getMessage
    const { browserId, origin, email } = clientId
    const query: { editorId: string; origin: string; email?: string; browserId?: string } = { editorId, origin }
    if (email) {
      query.email = email
    } else {
      query.browserId = browserId
    }
    const savedContent = (await (await maceCollection).find(query).sort({ timestamp: -1 }).limit(1).toArray())[0].saved
    const saveMessage = SaveMessage.check({ type: "save", ...savedContent })
    await doUpdate(clientId, saveMessage)
  } catch (err) {}
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
*/

const messager = new EventEmitter()

router.get("/", async (ctx) => {
  if (!ctx.ws) {
    ctx.body = serverStatus
    return
  }

  const connectionQuery = ConnectionQuery.check(ctx.request.query)
  const { version, commit, googleToken, client } = connectionQuery

  let email
  if (googleToken && googleClient) {
    try {
      email = (
        await googleClient.verifyIdToken({
          idToken: googleToken,
          audience: googleClientIDs || [],
        })
      ).getPayload()?.email
    } catch (err) {}
  }

  const versions = Versions.check({
    version: {
      server: VERSIONS.server,
      client: version,
    },
    commit: {
      server: VERSIONS.commit,
      client: commit,
    },
  })
  console.log(versions)

  const clientID = `${ctx.headers.origin}/${email || client}`
  const ws = PongWS(await ctx.ws())
  serverStatus.counts.client++
  // const collection = await maceCollection

  const updateListener = (updateMessage: UpdateMessage) => {
    ws.emit(JSON.stringify(updateMessage))
  }
  messager.addListener(clientID, updateListener)

  ws.addEventListener(
    "message",
    filterPingPongMessages(async ({ data }) => {
      const request = JSON.parse(data.toString())
      if (!ClientMessages.guard(request)) {
        console.error(`Bad message: ${data}`)
        return
      }
      if (UpdateMessage.guard(request)) {
        messager.emit(clientID, request)
        serverStatus.counts.update++
      } else if (GetMessage.guard(request)) {
        serverStatus.counts.get++
      }
    })
  )
  ws.addEventListener("close", () => {
    messager.removeListener(clientID, updateListener)
    try {
      ws.terminate()
    } catch (err) {}
    serverStatus.counts.client--
  })
})

maceCollection.then(async (c) => {
  console.log(JSON.stringify(serverStatus, null, 2))

  await c.createIndex({ clientId: 1, editorId: 1, timestamp: 1 })

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
