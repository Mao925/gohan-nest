// backend/src/lib/line-messaging.ts
import { Client, ClientConfig, Message } from "@line/bot-sdk";

const channelAccessToken = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;

if (!channelAccessToken) {
  throw new Error("LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not set");
}

const config: ClientConfig = {
  channelAccessToken,
};

const lineClient = new Client(config);

export async function sendMatchNotification(
  lineUserId: string,
  partnerName: string
) {
  console.log("[LINE] sendMatchNotification called", {
    lineUserId,
    partnerName,
  });

  const messages: Message[] = [
    {
      type: "text",
      text: `誰かとあなたがマッチしました！\n今回のお相手: ${partnerName}`,
    },
  ];

  try {
    const res = await lineClient.pushMessage(lineUserId, messages);
    console.log("[LINE] pushMessage success", res); // res は基本 {} だが一応
  } catch (err: any) {
    // line-bot-sdk のエラー詳細は originalError.response に入ることが多い
    // :contentReference[oaicite:0]{index=0}
    const status = err?.status || err?.originalError?.response?.status;
    const data = err?.originalError?.response?.data;
    console.error("Failed to send LINE match notification", {
      status,
      data,
      raw: err,
    });
  }
}
