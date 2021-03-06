# @cs125/mace

![npm](https://img.shields.io/npm/v/@cs125/mace)
![Docker Image Version (latest by date)](https://img.shields.io/docker/v/cs125/mace?color=green&label=Docker&sort=date)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

React TypeScript support for synchronizing [Ace browser editors](https://ace.c9.io/).

## Install

```bash
npm i @cs125/mace # client
docker pull cs125/mace # server
```

## Use

For a complete example of how to use `@cs125/mace` please see the [example in the repository](https://github.com/cs125-illinois/mace/tree/master/example).

First, wrap your app in the `<MaceProvider />` component, configured to point at your server (if you are using one):

```jsx
const App: React.FC = () => {
  return (
    <MaceProvider server={yourMaceServer} googleToken={yourGoogleToken}>
      <RestOfYourApp />
    </MaceProvider>
  )
}
```

Inside the `<MaceProvider />` you can use the `<MaceEditor />` component as a drop-in replacement for the `<AceEditor />` component provided by `react-ace`.
The only difference is that you need to provide an `id` prop uniquely identifying each editor instance.
Generating those IDs is up to you.
One way is to generate unique IDs such as UUIDs and save them with the page contents.
Another approach is to generate a unique ID that is a combination of the initial editor contents and its position on the page.

## Demo

Visit the demo [here](https://cs125-illinois.github.io/mace/).
