# github-webhook

[![NPM](https://nodei.co/npm/github-webhook.svg?style=flat&data=n,v&color=blue)](https://nodei.co/npm/github-webhook/)

A lightweight server that listens for GitHub Webhook events and executes commands when specific conditions are matched. Useful for automated deployments, CI triggers, and other GitHub-driven workflows.

## Installation

```sh
npm install -g github-webhook
```

## Quick Start

```sh
github-webhook \
  --port=9999 \
  --path=/webhook \
  --secret=mygithubsecret \
  --rule='push:ref == "refs/heads/master" && repository.name == "myrepo":./deploy.sh'
```

Then configure your GitHub repository's webhook settings to point to `http://yourserver:9999/webhook` with the matching secret.

## Configuration

You can configure github-webhook via command-line arguments or a JSON config file (or both - command-line overrides the config file).

### Command-line

```sh
github-webhook \
  --config=/etc/github-webhook.json \
  --port=9999 \
  --path=/webhook \
  --secret=mygithubsecret \
  --log=/var/log/webhook.log \
  --rule='push:ref == "refs/heads/master":./deploy.sh'
```

### Config file

```json
{
  "port": 9999,
  "path": "/webhook",
  "secret": "mygithubsecret",
  "log": "/var/log/webhook.log",
  "rules": [
    {
      "event": "push",
      "match": "ref == \"refs/heads/master\" && repository.full_name == \"myuser/myrepo\"",
      "exec": "/var/www/deploy.sh"
    }
  ]
}
```

### Options

| Option | Required | Description |
|--------|----------|-------------|
| `port` | Yes | Port to listen on (also respects `PORT` env var) |
| `path` | Yes | URL path to receive webhooks (e.g., `/webhook`) |
| `secret` | Yes | Webhook secret for payload verification (configure the same value in GitHub) |
| `host` | No | Bind to a specific host/IP address |
| `log` | No | Log file path, or `stdout`/`stderr` for console output |
| `rules` | No | Array of rules to match and execute (see below) |

## Rules

Rules define what commands to execute when specific webhook events are received.

### Rule properties

| Property | Description |
|----------|-------------|
| `event` | GitHub event type to match (`push`, `pull_request`, `issues`, etc.). Use `*` to match all events. See [GitHub Webhooks documentation](https://docs.github.com/en/webhooks) for available events. |
| `match` | Expression to match against the webhook payload. Uses [matchme](https://github.com/DamonOehlman/matchme) syntax. |
| `exec` | Command to execute. A string runs via `sh -c "..."`. An array executes directly (first element is the command, rest are arguments). |

### Command-line rule syntax

Rules can be specified on the command line as `--rule 'event:match:exec'`:

```sh
--rule 'push:ref == "refs/heads/master":./deploy.sh'
```

### Environment variables

Commands receive the entire webhook payload as environment variables with a `gh_` prefix:

- `gh_ref` - The git ref (e.g., `refs/heads/master`)
- `gh_branch` - The branch name (extracted from ref for convenience)
- `gh_repository_name` - Repository name
- `gh_repository_full_name` - Full repository name (e.g., `owner/repo`)
- `gh_sender_login` - Username of the person who triggered the event
- ... and all other payload fields

Nested objects become underscore-separated (e.g., `gh_repository_owner_login`).

### Example rules

Deploy on push to master:
```json
{
  "event": "push",
  "match": "ref == \"refs/heads/master\" && repository.full_name == \"myuser/myrepo\"",
  "exec": "/var/www/deploy.sh"
}
```

Run tests on pull request:
```json
{
  "event": "pull_request",
  "match": "action == \"opened\" || action == \"synchronize\"",
  "exec": ["./run-tests.sh", "--pr"]
}
```

Log all events:
```json
{
  "event": "*",
  "match": "true",
  "exec": "echo \"Received $gh_event\" >> /var/log/webhooks.log"
}
```

## Running as a Service

### systemd (recommended)

Create `/etc/systemd/system/github-webhook.service`:

```ini
[Unit]
Description=GitHub Webhook Server
After=network.target

[Service]
Type=simple
User=www-data
ExecStart=/usr/bin/github-webhook --config /etc/github-webhook.json
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then enable and start:

```sh
sudo systemctl daemon-reload
sudo systemctl enable github-webhook
sudo systemctl start github-webhook
sudo systemctl status github-webhook
```

View logs:

```sh
sudo journalctl -u github-webhook -f
```

### Running behind a reverse proxy

For production, run github-webhook behind nginx or another reverse proxy that handles TLS:

```nginx
location /webhook {
    proxy_pass http://127.0.0.1:9999;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

Then configure github-webhook with `--host=127.0.0.1` to only accept local connections.

## Programmatic Usage

```js
import webhook from 'github-webhook'

const server = webhook({
  port: 9999,
  path: '/webhook',
  secret: 'mygithubsecret',
  rules: [
    {
      event: 'push',
      match: 'ref == "refs/heads/master"',
      exec: './deploy.sh'
    }
  ]
})

server.listen(9999, () => {
  console.log('Webhook server listening on port 9999')
})
```

The function returns an `http.Server` instance with an attached `webhookHandler` for custom event handling:

```js
server.webhookHandler.on('push', (event) => {
  console.log('Push event:', event.payload)
})
```

## Debugging

Enable debug output with the `DEBUG` environment variable:

```sh
DEBUG=github-webhook:* github-webhook --config /etc/github-webhook.json
```

## More Information

**github-webhook** is powered by [github-webhook-handler](https://github.com/rvagg/github-webhook-handler).

## License

**github-webhook** is Copyright (c) 2015 Rod Vagg and licensed under the MIT License. All rights not explicitly granted in the MIT License are reserved. See the included [LICENSE.md](./LICENSE.md) file for more details.
