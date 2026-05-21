# Chatbot

A Gemini-powered chat application with memory, built with Express, React, Prisma, and pgvector.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (for Postgres + pgvector)
- [Node.js](https://nodejs.org/) v24+
- A [Gemini API key](https://aistudio.google.com/app/apikey)

## Getting started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment variables**

   ```bash
   # Copy the example file for each package
   cp .env.example server/.env
   cp .env.example client/.env
   ```

   Open `server/.env` and fill in at minimum:
   - `BETTER_AUTH_SECRET` — generate with `openssl rand -hex 32`
   - `GEMINI_API_KEY` — from Google AI Studio

3. **Start the database**

   ```bash
   npm run db:up
   ```

4. **Run Prisma migrations** *(after the schema is added in a later task)*

   ```bash
   npm run db:migrate -w server
   ```

5. **Start the dev servers**

   ```bash
   npm run dev
   ```

   - API server: <http://localhost:3000>
   - Client: <http://localhost:5173>

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start server + client together |
| `npm run db:up` | Start Postgres in Docker |
| `npm run db:down` | Stop Postgres |
| `npm test` | Run all test suites |
