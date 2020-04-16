import React, { Component, createRef, ReactElement } from "react"
import { hot } from "react-hot-loader"
import PropTypes from "prop-types"

import { Container } from "semantic-ui-react"

import { MDXProvider } from "@mdx-js/react"
import Content from "./index.mdx"

import { MaceEditor, MaceProvider, MaceProps } from "react-mace"
import Children from "react-children-utilities"
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/default-highlight"

import "ace-builds/src-noconflict/theme-chrome"
import ace from "ace-builds/src-noconflict/ace"
const CDN = "https://cdn.jsdelivr.net/npm/ace-builds@1.4.11/src-min-noconflict"
ace.config.set("basePath", CDN)

class MacePlayground extends Component<MaceProps, { value: string }> {
  private aceRef = createRef<MaceEditor>()
  constructor(props: MaceProps) {
    super(props)
    this.state = { value: props.children || "" }
  }

  save = (): void => {
    this.aceRef?.current?.save()
  }

  render(): ReactElement {
    const commands = (this.props.commands || []).concat([
      {
        name: "save",
        bindKey: { win: "Ctrl-Enter", mac: "Ctrl-Enter" },
        exec: this.save,
      },
    ])
    return (
      <MaceEditor
        ref={this.aceRef}
        value={this.state.value}
        onExternalUpdate={(value: string): void => {
          this.setState({ value })
        }}
        onChange={(value: string): void => {
          this.setState({ value })
        }}
        commands={commands}
        {...this.props}
      />
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
  <MaceProvider server="ws://localhost:8888">
    <Container text style={{ paddingTop: 16 }}>
      <MDXProvider components={components}>
        <Content />
      </MDXProvider>
    </Container>
  </MaceProvider>
)
export default hot(module)(App)
