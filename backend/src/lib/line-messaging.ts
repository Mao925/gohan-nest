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
  partnerName: string // 受け取るが本文では使わない
) {
  console.log("[LINE] sendMatchNotification called", {
    lineUserId,
    partnerName,
  });

  const messages: Message[] = [
    {
      type: "text",
      text: [
        "🎉 ごはんマッチ成立！ 🎉",
        "",
        "おつかれさまです、だれかとごはんマッチが成立しました🍽️",
        "",
        "📱 アプリ内の「マッチ一覧」から、今回マッチしたお相手をチェックしてみてください👀",
        "",
        "🗓️ トークルームで",
        "・行けそうな日程",
        "・エリアや最寄り駅",
        "・行ってみたいお店候補",
        "をゆるく相談してみましょう！",
        "",
        "いいごはん時間になりますように😋✨",
      ].join("\n"),
    },
  ];

  try {
    const res = await lineClient.pushMessage(lineUserId, messages);
    console.log("[LINE] pushMessage success", res);
  } catch (err: any) {
    const status = err?.status || err?.originalError?.response?.status;
    const data = err?.originalError?.response?.data;
    console.error("Failed to send LINE match notification", {
      status,
      data,
      raw: err,
    });
  }
}
