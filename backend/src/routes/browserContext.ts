import { Router } from "express";
import { isLineInAppBrowser } from "../utils/detectLineInAppBrowser.js";

const browserContextRouter = Router();

browserContextRouter.get("/", (req, res) => {
  const userAgentHeader = req.headers["user-agent"];
  const isLine = isLineInAppBrowser(userAgentHeader as string | undefined | string[]);

  res.setHeader("Cache-Control", "no-store");
  return res.json({
    isLineInAppBrowser: isLine,
    suggestExternalBrowser: isLine,
    userAgent: process.env.NODE_ENV === "production" ? undefined : userAgentHeader,
  });
});

export default browserContextRouter;
