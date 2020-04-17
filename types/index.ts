import { Record, Partial, Number, Static, String, Array, Literal, Union } from "runtypes"

export const DeltaLocation = Record({
  row: Number,
  column: Number,
})
export type DeltaLocation = Static<typeof DeltaLocation>

export const Delta = Record({
  timestamp: String.withConstraint((s) => Date.parse(s) !== NaN),
  start: DeltaLocation,
  end: DeltaLocation,
  action: String,
  lines: Array(String),
}).And(
  Partial({
    id: Number,
  })
)
export type Delta = Static<typeof Delta>

export const SaveMessage = Record({
  type: Literal("save"),
  editorId: String,
  saveId: String,
  value: String,
  deltas: Array(Delta),
})
export type SaveMessage = Static<typeof SaveMessage>

export const UpdateMessage = Record({
  type: Literal("update"),
  editorId: String,
  saveId: String,
  value: String,
})
export type UpdateMessage = Static<typeof UpdateMessage>

export const GetMessage = Record({
  type: Literal("get"),
  editorId: String,
})
export type GetMessage = Static<typeof GetMessage>

export const ClientMessages = Union(SaveMessage, GetMessage)
export const ServerMessages = Union(UpdateMessage)

export const ConnectionQuery = Record({
  browserId: String,
}).And(
  Partial({
    googleToken: String,
  })
)

export type ConnectionQuery = Static<typeof ConnectionQuery>
