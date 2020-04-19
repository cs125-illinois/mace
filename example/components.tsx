import React, { Component, createRef, ReactElement } from "react"
import PropTypes from "prop-types"

import { Container, Button } from "semantic-ui-react"

import { MaceEditor, MaceProps, MaceContext } from "@cs125/mace"

import Children from "react-children-utilities"
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/default-highlight"

import "ace-builds/src-noconflict/theme-chrome"
import ace from "ace-builds/src-noconflict/ace"
const CDN = "https://cdn.jsdelivr.net/npm/ace-builds@1.4.11/src-min-noconflict"
ace.config.set("basePath", CDN)

class MacePlayground extends Component<MaceProps, { value: string; saved: boolean; saving: boolean }> {
  static contextType = MaceContext
  declare context: React.ContextType<typeof MaceContext>

  private maceRef = createRef<MaceEditor>()
  private originalValue: string
  private savedValue: string
  private saveTimer: NodeJS.Timeout | undefined

  constructor(props: MaceProps, context: MaceContext) {
    super(props, context)

    this.originalValue = props.children || ""
    this.savedValue = this.originalValue

    this.state = { value: this.originalValue, saved: true, saving: false }
  }

  componentWillUnmount(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
  }

  save = (): void => {
    if (this.state.saved) {
      return
    }
    this.setState({ saving: true })
    this.maceRef?.current?.save()
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
  }

  reset = (): void => {
    this.maceRef?.current?.setValue(this.originalValue)
  }

  render(): ReactElement {
    const { saved, saving } = this.state
    const { connected } = this.context

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
          ref={this.maceRef}
          value={this.state.value}
          onExternalUpdate={({ value }): void => {
            this.savedValue = value
            this.setState({ value, saved: value === this.savedValue })
          }}
          onSave={(value: string): void => {
            this.savedValue = value
            this.setState({ saving: false, saved: value === this.savedValue })
          }}
          onChange={(value: string): void => {
            this.setState({ value, saved: value === this.savedValue })
            if (this.saveTimer) {
              clearTimeout(this.saveTimer)
            }
            this.saveTimer = setTimeout(() => {
              this.save()
            }, 1000)
          }}
          commands={commands}
          {...this.props}
        />
        <Button floated="right" size="mini" disabled={original} onClick={this.reset}>
          Reset
        </Button>
        <Button
          floated="right"
          size="mini"
          positive={connected}
          disabled={!connected || saved}
          loading={saving}
          onClick={this.save}
        >
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
export default components
