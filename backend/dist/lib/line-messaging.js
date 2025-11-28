// backend/src/lib/line-messaging.ts
import { Client } from "@line/bot-sdk";
const channelAccessToken = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
if (!channelAccessToken) {
    throw new Error("LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not set");
}
const config = {
    channelAccessToken,
};
const lineClient = new Client(config);
/**
 * 「誰かがあなたにYESを押したとき」に送る通知
 * partnerNameは互換性のために受け取るが、本文では使わない
 */
export async function sendMatchNotification(lineUserId, _partnerName) {
    console.log("[LINE] sendMatchNotification (got-like) called", {
        lineUserId,
    });
    const messages = [
        {
            type: "text",
            text: [
                "誰かがあなたとご飯に行きたいようです🍚",
                "",
                "▼今すぐアプリをチェック👀",
                "https://gohan-expo.vercel.app/login",
            ].join("\n"),
        },
    ];
    try {
        const res = await lineClient.pushMessage(lineUserId, messages);
        console.log("[LINE] pushMessage success", res);
    }
    catch (err) {
        const status = err?.status || err?.originalError?.response?.status;
        const data = err?.originalError?.response?.data;
        console.error("Failed to send LINE 'got-like' notification", {
            status,
            data,
            raw: err,
        });
    }
}
