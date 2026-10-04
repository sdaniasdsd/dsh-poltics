/**
 * 训练场剧情的「选择扮演主角」选择器。
 *
 * 元数据随卡走：由内容管线的 build_cards.mjs 写进 card.extensions['tavern-gym']，
 * 客户端经 getCharacterDetail.extensions 读取（remote.ts 的 CharacterDetail.extensions），
 * 不新增任何 remote 方法。
 *
 * 下标契约：本组件的 index 与插件 cardGreetingVariants 的下标严格一致
 * —— [firstMes, ...alternateGreetings]，firstMes 为空时第一条备选占 0。
 * 因此「第 N 个主角」永远等于「第 N 条开场白」，hero 只需维护 binding.greetingIndex。
 */
import type { CharacterDetail } from './types.js';
import './styles.js';
/** 单个可扮演主角。英雄区只用到展示字段；剧情库点开时会用到完整简报。 */
export interface GymProtagonist {
    index: number;
    name: string;
    position: string;
    difficulty: string;
    goal: string;
    /** 起手就知道的信息。 */
    knows: string[];
    /** 起手不知道、需要自己挖的信息。 */
    unaware: string[];
    /** 起手手里的筹码。 */
    leverage: string[];
    /** 起手的约束与代价。 */
    constraints: string[];
    /** 现实里这个位置的结算等级；无则为 null。 */
    grade: string | null;
    main: number | null;
}
/** 单个关卡（阶段）：历史副本才有，当代副本为空数组。 */
export interface GymPhase {
    id: number;
    name: string;
    window: string;
    /** 这一关的局面。 */
    situation: string;
    /** 这一关必须让用户知道的明确任务。 */
    tasks: string[];
    /** 博弈焦点。 */
    focus: string;
    /** 对手可能怎么走。 */
    opponentMoves: string;
    /** 这一关如何判定成败。 */
    settleAt: string;
}
/** 玩家可见的背景简报。隐藏诉求不在这里——那是模型用的。 */
export interface GymBriefing {
    /** 时代／公司／层面的背景交代。 */
    stage: string;
    /** 一句话处境。 */
    situation: string;
    /** 纪年或时段。 */
    period: string;
    /** 整局的跨度。 */
    span: string;
    /** 赌注：输了会失去什么。 */
    stakes: string;
    /** 明规则与潜规则。 */
    rules: string[];
    /** 节拍：什么时候会被迫结算。 */
    clock: string;
}
/** 怎么玩。 */
export interface GymHowto {
    /** 怎么对话。 */
    talk: string;
    /** 关卡怎么推进。 */
    advance: string;
    /** 什么时候结算。 */
    settle: string;
}
/** 一张训练场剧情卡携带的全部主角元数据。 */
export interface GymMeta {
    scenarioId: string;
    role: string;
    protagonists: GymProtagonist[];
    /** 关卡链；当代副本为 []。前端据此把「副本 → 关卡」两级结构显示出来。 */
    phases: GymPhase[];
    /** 副本类型。 */
    kind: 'history' | 'contemporary';
    /** 纪年或行业跨度。 */
    period: string;
    /** 一句话前情。 */
    premise: string;
    /** 背景简报；旧宿主可能没有。 */
    briefing: GymBriefing | null;
    /** 玩法说明；旧宿主可能没有。 */
    howto: GymHowto | null;
}
/**
 * 从角色详情里安全解析主角表。形状不符一律返回 null（不因 TypeScript 注解就信任 JSON）。
 * 少于 2 个主角时返回 null —— 单个主角没有「选择」的意义，交回原来的开场白翻页。
 */
export declare function gymMetaOf(detail: CharacterDetail): GymMeta | null;
/**
 * 主角选择器。受控组件：只通过 onSelect 上报下标，写绑定由调用方负责，
 * 这样英雄区与对话框两个入口能复用同一份逻辑。
 */
export declare function GymProtagonistPicker(props: {
    meta: GymMeta;
    index: number;
    disabled?: boolean;
    onSelect: (index: number) => void;
}): import("react").JSX.Element;
