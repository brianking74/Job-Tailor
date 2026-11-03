<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/48f92d73-7f09-4798-b35e-97f21f9f0f21

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the AI provider variables in [.env.local](.env.local):
   - `AI_API_KEY` — your provider API key (default provider: OpenScale, https://app.openscale.so)
   - `AI_BASE_URL` — optional; defaults to `https://api.openscale.so/v1`
   - `AI_MODEL` — optional; defaults to `deepseek/deepseek-v4.1-flash`
3. Run the app:
   `npm run dev`

The backend talks to any OpenAI-compatible chat-completions endpoint, so switching
providers later only requires changing these three environment variables.
