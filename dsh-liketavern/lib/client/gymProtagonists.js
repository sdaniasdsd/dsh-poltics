import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useT } from './i18n.js';
import './styles.js';
function asRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : null;
}
function asText(value) {
    return typeof value === 'string' ? value : '';
}
/** 字符串数组字段：非数组或元素非字符串一律丢弃，不让坏数据渗进渲染。 */
function asTextArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => typeof item === 'string' && item.trim() !== '');
}
/** 难度只认三种刻度，其余一律按「普通」处理，避免自定义卡把 UI 撑坏。 */
function normalizeDifficulty(value) {
    const text = asText(value);
    return text === '地狱' || text === '困难' || text === '普通' ? text : '普通';
}
/**
 * 从角色详情里安全解析主角表。形状不符一律返回 null（不因 TypeScript 注解就信任 JSON）。
 * 少于 2 个主角时返回 null —— 单个主角没有「选择」的意义，交回原来的开场白翻页。
 */
export function gymMetaOf(detail) {
    const root = asRecord(detail.extensions?.['tavern-gym']);
    if (!root)
        return null;
    const list = root.protagonists;
    if (!Array.isArray(list))
        return null;
    const protagonists = [];
    list.forEach((raw, i) => {
        const item = asRecord(raw);
        if (!item)
            return;
        const name = asText(item.name);
        if (!name)
            return;
        const baseline = asRecord(item.baseline);
        protagonists.push({
            index: typeof item.index === 'number' && Number.isSafeInteger(item.index) ? item.index : i,
            name,
            position: asText(item.position),
            difficulty: normalizeDifficulty(item.difficulty),
            goal: asText(item.goal),
            knows: asTextArray(item.knows),
            unaware: asTextArray(item.unaware),
            leverage: asTextArray(item.leverage),
            constraints: asTextArray(item.constraints),
            grade: baseline ? asText(baseline.grade) || null : null,
            main: baseline && typeof baseline.main === 'number' ? baseline.main : null,
        });
    });
    if (protagonists.length < 2)
        return null;
    // 关卡链：坏条目跳过，缺字段用空值补——关卡缺失不该让整张卡失去主角选择器。
    const phases = [];
    if (Array.isArray(root.phases)) {
        for (const raw of root.phases) {
            const item = asRecord(raw);
            if (!item)
                continue;
            phases.push({
                id: typeof item.id === 'number' && Number.isSafeInteger(item.id) ? item.id : phases.length + 1,
                name: asText(item.name),
                window: asText(item.window),
                situation: asText(item.situation),
                tasks: asTextArray(item.tasks),
                focus: asText(item.focus),
                opponentMoves: asText(item.opponentMoves),
                settleAt: asText(item.settleAt),
            });
        }
    }
    // 简报与玩法：旧宿主可能没有这两个字段，缺了就当没有，不让它影响主角选择器。
    const briefingRaw = asRecord(root.briefing);
    const briefing = briefingRaw
        ? {
            stage: asText(briefingRaw.stage),
            situation: asText(briefingRaw.situation),
            period: asText(briefingRaw.period),
            span: asText(briefingRaw.span),
            stakes: asText(briefingRaw.stakes),
            rules: asTextArray(briefingRaw.rules),
            clock: asText(briefingRaw.clock),
        }
        : null;
    const howtoRaw = asRecord(root.howto);
    const howto = howtoRaw
        ? {
            talk: asText(howtoRaw.talk),
            advance: asText(howtoRaw.advance),
            settle: asText(howtoRaw.settle),
        }
        : null;
    return {
        scenarioId: asText(root.scenarioId),
        role: asText(root.role),
        protagonists,
        phases,
        kind: root.version === 3 || root.role === 'history' ? 'history' : 'contemporary',
        period: asText(root.period),
        premise: asText(root.premise),
        briefing,
        howto,
    };
}
/** 难度 → 样式档位，用于给按钮选强调色。 */
function difficultyTone(difficulty) {
    if (difficulty === '地狱')
        return 'hard';
    if (difficulty === '困难')
        return 'medium';
    return 'easy';
}
/**
 * 主角选择器。受控组件：只通过 onSelect 上报下标，写绑定由调用方负责，
 * 这样英雄区与对话框两个入口能复用同一份逻辑。
 */
export function GymProtagonistPicker(props) {
    const t = useT();
    const current = props.meta.protagonists.find((p) => p.index === props.index) ?? props.meta.protagonists[0];
    return (_jsxs("div", { className: "dsh-tavern-gym", children: [_jsxs("div", { className: "dsh-tavern-gym-head", children: [_jsx("span", { className: "dsh-tavern-gym-label", children: t('hero.gym.pickRole') }), current && current.grade ? (_jsx("span", { className: "dsh-tavern-gym-baseline", children: t('hero.gym.baseline', {
                            grade: current.grade,
                            main: current.main === null ? '-' : String(current.main),
                        }) })) : null] }), _jsx("div", { className: "dsh-tavern-gym-list", role: "radiogroup", "aria-label": t('hero.gym.pickRole'), children: props.meta.protagonists.map((p) => {
                    const active = p.index === props.index;
                    return (_jsxs("button", { type: "button", role: "radio", "aria-checked": active, "aria-pressed": active, disabled: props.disabled, className: `dsh-tavern-gym-item dsh-tavern-gym-item--${difficultyTone(p.difficulty)}`, onClick: () => props.onSelect(p.index), children: [_jsx("span", { className: "dsh-tavern-gym-name", children: p.name }), p.position ? _jsx("span", { className: "dsh-tavern-gym-pos", children: p.position }) : null, _jsx("span", { className: "dsh-tavern-gym-diff", children: p.difficulty })] }, p.index));
                }) }), current && current.goal ? _jsx("div", { className: "dsh-tavern-gym-goal", children: current.goal }) : null] }));
}
