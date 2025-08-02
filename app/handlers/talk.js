// handlers/talk.js

import config from '../../config/index.js';
import { t } from '../../locales/index.js';
import { ROLE_AI, ROLE_HUMAN } from '../../services/openai.js';
import { generateCompletion } from '../../utils/index.js';
import {
  
  COMMAND_BOT_CONTINUE,
  COMMAND_BOT_FORGET,
  COMMAND_BOT_TALK,
} from '../commands/index.js';
import Context from '../context.js';
import { updateHistory } from '../history/index.js';
import { getPrompt, setPrompt } from '../prompt/index.js';

/**
 * 判断是否应该进入 “talk” 逻辑
 * @param {Context} context
 * @returns {boolean}
 */
const check = (context) => (
  context.hasCommand(COMMAND_BOT_TALK)
  || context.hasBotName
  || context.source.bot.isActivated
);

/**
 * 处理用户发送的消息，调用 OpenAI 并分段回复
 * @param {Context} context
 * @returns {Promise<Context|boolean>}
 */
const exec = async (context) => {
  // 如果不符合条件就跳过
  if (!check(context)) {
    return false;
  }

  // 构建或读取对话提示
  const prompt = getPrompt(context.userId);

  try {
    // 把用户消息写入提示
    if (context.event.isText) {
      prompt
        .write(
          ROLE_HUMAN,
          `${t('__COMPLETION_DEFAULT_AI_TONE')(config.BOT_TONE)}${context.trimmedText}`
        )
        .write(ROLE_AI);
    }

    if (context.event.isImage) {
      // 如果是图片，带上说明
      const { trimmedText } = context;
      prompt.writeImage(ROLE_HUMAN, trimmedText).write(ROLE_AI);
    }

    // 调用 OpenAI 生成回复
    const { text, isFinishReasonStop } = await generateCompletion({ prompt });

    // 更新本地提示及历史记录
    prompt.patch(text);
    setPrompt(context.userId, prompt);
    updateHistory(context.id, (history) => history.write(config.BOT_NAME, text));

    // 根据停止原因决定按钮
    const actions = isFinishReasonStop
      ? [COMMAND_BOT_FORGET]
      : [COMMAND_BOT_CONTINUE];

    // —— 关键：分段拆块发送 —— 
    // LINE 单条最多 2000 字节，取 1000 字符为安全值
    const chunks = text.match(/[\s\S]{1,1000}/g) || [];

    // 第一块使用 replyMessage 并附带按钮
    if (chunks[0]) {
      await context.pushText(chunks[0], actions);
    }

    // 后续的每一块只发送文本，不附带按钮
    for (let i = 1; i < chunks.length; i++) {
      await context.pushText(chunks[i], []);
    }
  } catch (err) {
    // 捕获内部所有异常并反馈给用户或 log
    console.error('talk handler error:', err);
    context.pushError(err);
  }

  return context;
};

export default exec;

