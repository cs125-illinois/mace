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

const messager = new EventEmitter()

router.get("/", async (ctx) => {
  if (!ctx.ws) {
    ctx.body = serverStatus
    return
  }

  const origin = ctx.headers.origin
  const connectionQuery = ConnectionQuery.check(ctx.request.query)
  const { version, commit, googleToken, client } = connectionQuery

  let email: string | undefined
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

  const clientID = `${origin}/${email || client}`
  const ws = PongWS(await ctx.ws())
  serverStatus.counts.client++
  const collection = await maceCollection

  const updateListener = (updateMessage: UpdateMessage) => ws.send(JSON.stringify(updateMessage))
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
        if (request.streaming) {
          messager.emit(clientID, { ...request, local: false })
        } else {
          messager.emit(
            clientID,
            UpdateMessage.check({ ...request, local: false, records: [...request.records].slice(-1) })
          )
        }
        serverStatus.counts.update++
        collection.insertOne({
          id: request.id,
          origin,
          client,
          email,
          update: request,
          timestamp: new Date(),
          versions,
        })
      } else if (GetMessage.guard(request)) {
        const query: { id: string; origin: string; client?: string; email?: string } = {
          id: request.id,
          origin,
        }
        if (email) {
          query.email = email
        } else {
          query.client = client
        }
        const result = (await collection.find(query).sort({ timestamp: -1 }).limit(1).toArray())[0]
        if (result) {
          const update = UpdateMessage.check(result.update)
          messager.emit(clientID, { ...update, local: false })
        }
        ws.send(JSON.stringify({ ...request, local: false }))
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
  await c.createIndex({ id: 1, origin: 1, client: 1, email: 1, timestamp: 1 })

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
