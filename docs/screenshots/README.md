# Documentation screenshots

The public screenshots in this folder are generated from Scrubarr's browser
regression fixture. They contain only synthetic media names and placeholder
posters; never replace them with screenshots of a real library.

From the repository root, regenerate them after a deliberate UI change:

```bash
npm run build
npm run docs:screenshots
```

The same fixture also powers `npm run test:ui:browser`, without replacing the
checked-in screenshots.
