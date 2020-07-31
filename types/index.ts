import { Record, Partial, Number, Static, String, Array, Literal, Union } from "runtypes"
import { AceRecord } from "@cs125/monace"

export const Versions = Record({
  commit: Record({
    client: String,
    server: String,
  }),
  version: Record({
    client: String,
    server: String,
  }),
})
export type Versions = Static<typeof Versions>

export const UpdateMessage = Record({
  type: Literal("update"),
  id: String,
  view: String,
  save: String,
  records: Union(AceRecord, Array(AceRecord)),
})
export type UpdateMessage = Static<typeof UpdateMessage>

export const GetMessage = Record({
  type: Literal("get"),
  id: String,
})
export type GetMessage = Static<typeof GetMessage>

export const ClientMessages = Union(UpdateMessage, GetMessage)
export const ServerMessages = Union(UpdateMessage)

export const ConnectionQuery = Record({
  client: String,
  version: String,
  commit: String,
}).And(
  Partial({
    googleToken: String,
  })
)
export type ConnectionQuery = Static<typeof ConnectionQuery>

export const ServerStatus = Record({
  started: String.withConstraint((s) => Date.parse(s) !== NaN),
  version: String,
  commit: String,
  counts: Record({
    client: Number,
    update: Number,
    get: Number,
  }),
  googleClientIDs: Array(String),
})
export type ServerStatus = Static<typeof ServerStatus>
