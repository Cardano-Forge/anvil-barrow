import type { Schema } from "@cardano-ogmios/client";
import { type Level, pino } from "pino";
import { unwrap } from "trynot";
import { Controller, type ControllerEvent } from "./controller";
import { ErrorHandler } from "./error-handler";
import { ProcessingError, SocketClosedError, SocketError } from "./errors";
import { OgmiosSyncClient } from "./ogmios";

const logger = pino({
  level: "trace",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

const syncClient = new OgmiosSyncClient({
  host: process.env.OGMIOS_NODE_HOST,
  port: Number(process.env.OGMIOS_NODE_PORT),
  tls: Boolean(process.env.OGMIOS_NODE_TLS),
});

const errorHandler = new ErrorHandler()
  .register(
    ProcessingError,
    ErrorHandler.retry({ maxRetries: 1, baseDelay: 5000, persistent: true }),
  )
  .register(
    SocketError,
    ErrorHandler.retry({ maxRetries: 2, baseDelay: 5000, exponential: true }),
  )
  .register(
    SocketClosedError,
    ErrorHandler.retry({ maxRetries: 2, baseDelay: 5000, exponential: true }),
  );

const controller = new Controller({
  syncClient,
  errorHandler,
  eventHandler: (event) => {
    logger[getLogLevel(event)](event.data, event.type);
  },
});

const point: Schema.PointOrOrigin = {
  id: "fa5a6a51632b90557665fcb33970f4fb372dff6ad0191e083ff3b6b221f2b87e",
  slot: 101163751,
};

(async () => {
  await unwrap(
    controller.start({
      fn: processEvent,
      point,
      throttle: [100, "milliseconds"],
      // filter: (event) => event.type === "apply" && event.block.height === 3859660,
      takeUntil: ({ state }) => state.counters.applyCount >= 10,
    }),
  );
  await controller.waitForCompletion();
  if (controller.state.status === "paused") {
    await unwrap(controller.resume());
    await controller.waitForCompletion();
  }
})()
  .catch(console.error)
  .finally(() => process.exit(0));

let processed = 0;
function processEvent() {
  processed++;
  if (processed === 4) {
    // throw new Error("processing error");
  }
}

function getLogLevel(event: ControllerEvent): Level {
  switch (event.type) {
    case "event.received":
    case "event.processing": {
      return "trace";
    }
    case "event.filtered":
    case "event.processed":
    case "throttle.delay": {
      return "debug";
    }
    case "controller.started":
    case "controller.resumed":
    case "retry.started": {
      return "info";
    }
    case "controller.paused":
    case "error.handled":
    case "retry.scheduled": {
      return "warn";
    }
    case "error.caught": {
      return "error";
    }
    case "controller.completed": {
      return event.data.status === "crashed" ? "error" : "info";
    }
    default: {
      return "info";
    }
  }
}
