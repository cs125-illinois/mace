import React, { Component, createRef, ReactElement, ReactNode } from "react"
import { hot } from "react-hot-loader"
import PropTypes from "prop-types"

import { GoogleLoginProvider, WithGoogleLogin, getTokens } from "@cs125/react-google-login"

import { Container, Button } from "semantic-ui-react"

import { MDXProvider } from "@mdx-js/react"
import Content from "./index.mdx"

import { MaceEditor, MaceProvider, MaceProps } from "../client"
import Children from "react-children-utilities"
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/default-highlight"

import "ace-builds/src-noconflict/theme-chrome"
import ace from "ace-builds/src-noconflict/ace"
const CDN = "https://cdn.jsdelivr.net/npm/ace-builds@1.4.11/src-min-noconflict"
ace.config.set("basePath", CDN)

class MacePlayground extends Component<MaceProps, { value: string; saved: boolean; saving: boolean }> {
  private aceRef = createRef<MaceEditor>()
  private originalValue: string
  private savedValue: string

  constructor(props: MaceProps) {
    super(props)

    this.originalValue = props.children || ""
    this.savedValue = this.originalValue

    this.state = { value: this.originalValue, saved: true, saving: false }
  }

  save = (): void => {
    this.setState({ saving: true })
    this.aceRef?.current?.save()
  }

  reset = (): void => {
    this.aceRef?.current?.setValue(this.originalValue)
  }

  render(): ReactElement {
    const { saved, saving } = this.state

    let saveButtonText = "Save"
    if (saving) {
      saveButtonText = "Saving"
    } else if (saved) {
      saveButtonText = "Saved"
    }
    const original = this.state.value === this.originalValue

    const commands = (this.props.commands || []).concat([
      {
        name: "save",
        bindKey: { win: "Ctrl-s", mac: "Ctrl-s" },
        exec: this.save,
      },
    ])
    return (
      <Container style={{ position: "relative" }}>
        <MaceEditor
          style={{ paddingBottom: "1rem" }}
          ref={this.aceRef}
          value={this.state.value}
          onExternalUpdate={(value: string): void => {
            this.savedValue = value
            this.setState({ value })
          }}
          onSave={(value: string): void => {
            this.savedValue = value
            this.setState({ saving: false, saved: value === this.savedValue })
          }}
          onChange={(value: string): void => {
            this.setState({ value, saved: value === this.savedValue })
          }}
          commands={commands}
          {...this.props}
        />
        <Button floated="right" size="mini" disabled={original} onClick={this.reset}>
          Reset
        </Button>
        <Button floated="right" size="mini" positive disabled={saved} loading={saving} onClick={this.save}>
          {saveButtonText}
        </Button>
      </Container>
    )
  }
}

interface CodeBlockProps {
  className?: string
  play?: boolean
  id?: string
  children: React.ReactNode
}
const CodeBlock: React.FC<CodeBlockProps> = (props) => {
  const { id, className, play, children, ...aceProps } = props

  const language = className?.replace(/language-/, "") || ""
  const contents = Children.onlyText(children).trim()

  if (play) {
    return (
      <MacePlayground
        id={id as string}
        theme="chrome"
        mode={className?.replace(/language-/, "") || ""}
        highlightActiveLine={false}
        showPrintMargin={false}
        width="100%"
        height="100px"
        maxLines={Infinity}
        tabSize={2}
        {...aceProps}
      >
        {contents}
      </MacePlayground>
    )
  } else {
    return <SyntaxHighlighter language={language}>{children}</SyntaxHighlighter>
  }
}
CodeBlock.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node.isRequired,
}
CodeBlock.defaultProps = {
  className: "",
}
const components = {
  code: CodeBlock,
}
const App: React.SFC = () => (
  <GoogleLoginProvider
    // eslint-disable-next-line @typescript-eslint/camelcase
    clientConfig={{ client_id: "948918026196-eh2lctl77k8pik8ugvlq1hf69vqoafd4.apps.googleusercontent.com" }}
  >
    <WithGoogleLogin>
      {({ user }): JSX.Element => {
        const googleToken = user ? getTokens(user).id_token : undefined
        return (
          <MaceProvider server="ws://localhost:8888" googleToken={googleToken} saveToLocalStorage>
            <Container text style={{ paddingTop: 16 }}>
              <MDXProvider components={components}>
                <Content />
              </MDXProvider>
            </Container>
          </MaceProvider>
        )
      }}
    </WithGoogleLogin>
  </GoogleLoginProvider>
)
export default hot(module)(App)
