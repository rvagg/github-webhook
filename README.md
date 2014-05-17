# github-webhook

[![NPM](https://nodei.co/npm/github-webhook.svg)](https://nodei.co/npm/github-webhook/)

A stand-alone GitHub Webhook end-point server.

## Example

```text
github-webhook \
  --port=9999 \
  --path=/webhook \
  --secret=mygithubsecret \
  --log=/var/log/webhook.log \
  --rule='push:ref == refs/heads/master && repository.name == myrepo:echo "yay!"'
```

You can also specify a `--config <file>` where *file* is a JSON file containing the same properties as are available as commandline options. The commandline will always override properties in the config file though.

```json
{
  "port": 9999,
  "path": "/webhook",
  "secret": "mygithubsecret",
  "log": "/var/log/webhook.log",
  "rules": [{
    "event": "push",
    "match": "ref == \"refs/heads/master\" && repository.name == \"myrepo\"",
    "exec": "echo yay!"
  }]
}
```

## Options

* **port** (required): the port for the server to listen to (also respects `PORT` env var), should match what you tell GitHub
* **path** (required): the path / route to listen to webhook requests on, should match what you tell GitHub
* **secret** (required): the key used to hash the payload by GitHub that we verify against, should match what you tell GitHub
* **host** (optional): if you want to restrict `listen()` to a specific host
* **log** (optional): a file to print logs to, each command execution will be logged, also note that you can set the `DEBUG` env var to see debug output (see [debug](https://github.com/visionmedia/debug)) 
* **rules** (optional): an array of objects representing rules to match against and commands to execute, can also be supplied as individual `--rule` commandline arguments where the 3 properties are separated by `:` (details below)

### Rules

When reacting to valid GitHub Webhook payloads, you can specify any number of rules that will be matched and execute commands in a forked shell. Rules have three components:

* `"event"`: the event type to match, see the [GitHub Webhooks documentation](https://developer.github.com/webhooks/) for more details on the events you can receive
* `"match"`: a basic object matching rule that will be applied against the payload received from GitHub. Should be flexible enough to match very specific parts of the PayLoad. See [matchme](https://github.com/DamonOehlman/matchme) for how this works.
* `"exec"`: a system command to execute if this rule is matched, should obviously be something related to the event, perhaps a deploy on `"push"` events?

You can either specify these rules in an array on the `"rules"` property in the config file, or as separate `--rule` commandline arguments where the components are separated by `:`, e.g.: `--rule event:match:exec` (you will generally want to quote the rule to prevent shell trickery).

## Programatic usage

You can `var server = require('github-webhook')(options)` and you'll receive a `http.Server` object that has been prepared but not started.

## More information

**github-webhook** is powered by [github-webhook-handler](https://github.com/rvagg/github-webhook-handler), see that for more details.

## License

**github-webhook** is Copyright (c) 2014 Rod Vagg [@rvagg](https://twitter.com/rvagg) and licensed under the MIT License. All rights not explicitly granted in the MIT License are reserved. See the included [LICENSE.md](./LICENSE.md) file for more details.
