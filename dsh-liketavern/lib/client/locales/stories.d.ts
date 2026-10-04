/**
 * 剧情库分区（panel/stories.tsx）界面文案。zh 为键全集源，en 必须同键齐全
 * （test/i18n.test.ts 校验：同键、非空、en 不含汉字）。
 *
 * 岗位名按剧情 JSON 的 role 取值给中文；未知 role 回落到「通用」。
 */
export declare const zh: {
    readonly 'stories.title': "剧情库";
    readonly 'stories.intro': "副本是一局，关卡是这一局里的第几步。先挑副本，再点开关卡看这一关要办成什么，最后在会话英雄区挑你要扮演的人。";
    readonly 'stories.searchLabel': "搜索副本";
    readonly 'stories.searchPlaceholder': "副本名、纪年、编号或主角名";
    readonly 'stories.entity': "副本";
    readonly 'stories.emptyTitle': "还没有副本";
    readonly 'stories.emptyDesc': "把 04_剧情 里的 JSON 转换进角色库之后，每一篇都会列在这里。";
    readonly 'stories.protagonists': "{count} 个可扮演主角";
    readonly 'stories.baseline': "原型结算 {grade}";
    readonly 'stories.noGrade': "原型无确定结局";
    readonly 'stories.fidelitySuspect': "疑似虚构";
    readonly 'stories.expandHint': "点开看关卡";
    readonly 'stories.collapseHint': "收起";
    readonly 'stories.knows': "起手就知道";
    readonly 'stories.unaware': "起手不知道";
    readonly 'stories.leverage': "手里的筹码";
    readonly 'stories.constraints': "约束与代价";
    readonly 'stories.briefFailed': "这个副本的关卡与位置读取失败，可以先选中它再在会话里看。";
    readonly 'stories.searchHint': "选中一个副本后进入会话，在英雄区点开角色芯片即可切换扮演主角。";
    readonly 'stories.track.all': "全部 {count}";
    readonly 'stories.track.history': "历史副本 {count}";
    readonly 'stories.track.contemporary': "当代副本 {count}";
    readonly 'stories.kind.history': "历史";
    readonly 'stories.kind.contemporary': "当代";
    readonly 'stories.levels': "{count} 个关卡";
    readonly 'stories.singleLevel': "单关";
    readonly 'stories.positions': "{count} 个位置";
    readonly 'stories.levelChain': "关卡链";
    readonly 'stories.roles': "可扮演位置";
    readonly 'stories.taskCount': "{count} 项任务";
    readonly 'stories.levelTasks': "本关任务（进入这一关时必须让你知道）";
    readonly 'stories.levelFocus': "博弈焦点";
    readonly 'stories.levelOpponent': "对手可能怎么走";
    readonly 'stories.levelSettle': "这一关如何判定成败";
    readonly 'stories.noLevels': "这个副本没有划分关卡——一次成局，由局面自己演化。";
    readonly 'stories.hostStale': "关卡数据没载入：宿主的角色数据层还是旧版（Node 侧不随前端热重载）。重启一次 DSH 就能看到关卡链。";
    readonly 'stories.levelsUnknown': "关卡未载入";
    readonly 'stories.background': "背景（进场前给你看）";
    readonly 'stories.bgPeriod': "纪年";
    readonly 'stories.bgStage': "局面";
    readonly 'stories.bgStakes': "赌注";
    readonly 'stories.bgRules': "明规则与潜规则";
    readonly 'stories.bgClock': "节拍";
    readonly 'stories.howto': "怎么玩";
    readonly 'stories.howtoTalk': "怎么说话";
    readonly 'stories.howtoAdvance': "怎么推进";
    readonly 'stories.howtoSettle': "怎么结算";
    readonly 'stories.role.sales': "销售";
    readonly 'stories.role.engineer': "工程师";
    readonly 'stories.role.procurement': "采购";
    readonly 'stories.role.worker': "工人";
    readonly 'stories.role.general': "通用";
    readonly 'stories.role.history': "历史";
};
export declare const en: Record<keyof typeof zh, string>;
