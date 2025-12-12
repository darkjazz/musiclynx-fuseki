## About This Project

This is a project to create a reliable triple store endpoint containing music artist abstracts and categories
for the https://musiclynx.github.io discovery platform. The server component is currently querying dbpedia endpoints 
which are not reliable, so it is necessary to find an alternative solution using data dumps to set up a triple store

# Project Context

Ask clarifying questions before making architectural changes.
Always inform when git push is required, it is manually done.

## Key Directories

- `./data` - extracted triples for abstracts and categories

## Other relevant repositories 

- `https://github.com/darkjazz/musiclynx` - musiclynx frontend in angular
- `https://github.com/darkjazz/musiclynx-server` - musiclynx server in express.js

## Websites 

- `https://musiclynx.github.io/#/dashboard` - musiclynx ui
- `https://musiclynx-server.fly.dev` - musiclynx server deployment

## Standards

- Always fix whitespaces
