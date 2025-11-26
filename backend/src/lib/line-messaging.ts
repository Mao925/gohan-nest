import { Client, ClientConfig, Message } from '@line/bot-sdk';

const channelAccessToken = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;

if (!channelAccessToken) {
  // 起動時に気づけるようにしておく
  throw new Error('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not set');
}

const config: ClientConfig = {
  channelAccessToken,
};

const lineClient = new Client(config);

/**
 * マッチ成立時にユーザーへ送る通知メッセージを送信する。
 * @param lineUserId LINEのユーザーID（U から始まるID）
 * @param partnerName マッチした相手の名前
 */
export async function sendMatchNotification(
  lineUserId: string,
  partnerName: string,
) {
  const messages: Message[] = [
    {
      type: 'text',
      text: `誰かとあなたがマッチしました！\n今回のお相手: ${partnerName}`,
    },
  ];

  try {
    await lineClient.pushMessage(lineUserId, messages);
  } catch (err) {
    // ここはあとで logger に差し替えてもOK
    console.error('Failed to send LINE match notification', err);
  }
}
