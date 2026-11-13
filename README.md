# EMESSA Business Manager

![Under development](docs/under-development.gif)

**Work in progress.** This is an unfinished project. The inventory screens are the furthest along, and the batch investment and import-cost workspace is still in development.

EMESSA is a web app for managing products, stock, and sales. The plan is to have one workspace for day-to-day warehouse and sales work and another for tracking what each import batch costs. The app runs in your browser and uses Google Sheets to store business records when connected.

## Try it locally

Install Node.js 22.12 or later, then run:

```sh
npm ci
```

Copy `.dev.vars.example` to `.dev.vars`, then run:

```sh
npm run dev
```

Open [the local sign-in page](http://localhost:5173/login) and choose **Explore sample workspace**. You can browse products and stock using read-only sample data, without a Google account or a workbook.

## Connect your own workbook

Follow the [setup guide](docs/SETUP.md) to connect Google Sheets and configure a staging copy. Use the staging copy to try stock changes before working with live records.

## Run the checks

```sh
npm test
npm run verify:readonly
npm run verify:inventory
npm run build
```
