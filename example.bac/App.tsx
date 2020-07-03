import React from "react"
import { hot } from "react-hot-loader"

import { GoogleLoginProvider, WithGoogleTokens } from "@cs125/react-google-login"

import { Container } from "semantic-ui-react"

import { MDXProvider } from "@mdx-js/react"

import Start from "./start.mdx"
import WithServer from "./withserver.mdx"
import NoServer from "./noserver.mdx"
import Use from "./use.mdx"

import { MaceProvider } from "@cs125/mace"

import components from "./components"

const App: React.SFC = () => (
  <GoogleLoginProvider clientConfig={{ client_id: process.env.GOOGLE_CLIENT_IDS as string }}>
    <WithGoogleTokens>
      {({ idToken }): JSX.Element => {
        return (
          <Container text style={{ paddingTop: 16 }}>
            <MDXProvider components={components}>
              <Start />
              <MaceProvider server={process.env.MACE_SERVER} googleToken={idToken}>
                <WithServer />
              </MaceProvider>
              <MaceProvider>
                <NoServer />
              </MaceProvider>
              <Use />
            </MDXProvider>
          </Container>
        )
      }}
    </WithGoogleTokens>
  </GoogleLoginProvider>
)
export default hot(module)(App)
