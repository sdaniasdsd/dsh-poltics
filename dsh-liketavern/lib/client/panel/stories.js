import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * 设置面板分区：副本库。
 *
 * 这里把「副本」与「关卡」两级分开呈现，而不是把 30 张卡平铺成一列：
 *
 *   赛道（历史副本 / 当代副本）
 *     └ 副本（一张卡 = 一局）
 *         └ 关卡（历史副本的阶段；当代副本没有关卡）
 *             └ 明确任务（每关必须让用户知道的事）
 *
 * 之所以这样分层：副本之间是「换一局」，关卡之间是「同一局里的第几步」——
 * 两者的量级完全不同，混在一列里用户看不出自己点的是哪一层。
 *
 * 数据来源：列表走 listCharacters 的 gym 投影（只有关卡名与任务数），
 * 展开某个副本时再懒加载一次 getCharacterDetail 取关卡的完整内容，并按 cardId 缓存。
 */
import { Component, useState } from 'react';
import { gymMetaOf } from '../gymProtagonists.js';
import { useT } from '../i18n.js';
import { Badge, Err, SearchEmpty, SearchInput, Section, Skeleton, clickableProps, useLoader } from '../util.js';
/**
 * 分区级错误边界。
 *
 * 面板里任何一处渲染抛异常，都会让整个挂载子树卸载——用户看到的就是白屏，
 * 而且拿不到任何线索。这一层把异常转成可读提示，把「白屏」变成「能报告的错误」。
 */
class SectionBoundary extends Component {
    state = { error: null };
    static getDerivedStateFromError(cause) {
        return { error: cause instanceof Error ? cause.message : String(cause) };
    }
    render() {
        if (this.state.error !== null) {
            return _jsx(Err, { message: `${this.state.error}` });
        }
        return this.props.children;
    }
}
/** role 取值 → 文案键。用字面量键，好让 i18n 测试能校验它们真的存在。 */
const ROLE_KEY = {
    sales: 'stories.role.sales',
    engineer: 'stories.role.engineer',
    procurement: 'stories.role.procurement',
    worker: 'stories.role.worker',
    history: 'stories.role.history',
    general: 'stories.role.general',
};
/** 简报里的一组条目；空数组整组不渲染，避免出现空标题。 */
function BriefList(props) {
    if (props.items.length === 0)
        return null;
    return (_jsxs("div", { className: "dsh-tavern-storyBriefGroup", children: [_jsx("span", { className: "dsh-tavern-storyBriefLabel", children: props.label }), _jsx("ul", { className: "dsh-tavern-storyBriefList", children: props.items.map((item, index) => _jsx("li", { children: item }, index)) })] }));
}
/**
 * 把 RPC 回来的副本摘要归一化。
 *
 * **不能因为 TypeScript 注解就信任运行期数据。** Node 侧的 state 层不随客户端热重载，
 * 宿主可能仍在跑旧版投影——那样 `kind` 与 `phases` 会整个缺失。
 * 缺字段一律按「未知」补空值，绝不在渲染里裸取属性（那会让整个面板白屏）。
 */
function normalizeGym(card) {
    const gym = card.gym;
    return {
        scenarioId: gym.scenarioId ?? '',
        role: gym.role ?? '',
        protagonistCount: gym.protagonistCount ?? 0,
        grade: gym.grade ?? null,
        premise: gym.premise ?? '',
        fidelity: gym.fidelity ?? '',
        // kind 缺失时从 role 反推：旧版投影没有 kind，但历史副本的 role 一直是 'history'。
        kind: gym.kind ?? (gym.role === 'history' ? 'history' : 'contemporary'),
        period: gym.period ?? '',
        phases: Array.isArray(gym.phases) ? gym.phases : [],
    };
}
export function StoriesSection(props) {
    return (_jsx(SectionBoundary, { children: _jsx(StoriesBody, { remote: props.remote }) }));
}
function StoriesBody(props) {
    const t = useT();
    const { state } = useLoader(() => props.remote.listCharacters({}), []);
    const [query, setQuery] = useState('');
    const [track, setTrack] = useState('all');
    const [openId, setOpenId] = useState(null);
    const [openPhase, setOpenPhase] = useState(null);
    // 副本详情按 cardId 懒加载并缓存：展开过的不再拉第二次；null 表示拉失败。
    const [briefs, setBriefs] = useState({});
    const [busyId, setBusyId] = useState(null);
    const load = async (cardId) => {
        if (briefs[cardId] !== undefined)
            return;
        setBusyId(cardId);
        try {
            const result = await props.remote.getCharacterDetail({ cardId });
            // 用 .ok 判别式收窄，errOf 只给消息不做收窄。
            setBriefs((prev) => ({ ...prev, [cardId]: result.ok ? gymMetaOf(result.value) : null }));
        }
        catch {
            setBriefs((prev) => ({ ...prev, [cardId]: null }));
        }
        finally {
            setBusyId(null);
        }
    };
    const toggleDungeon = (cardId) => {
        if (openId === cardId) {
            setOpenId(null);
            setOpenPhase(null);
            return;
        }
        setOpenId(cardId);
        setOpenPhase(null);
        void load(cardId);
    };
    const dungeons = (state.status === 'ready' ? state.value.items : []).filter((card) => card.gym !== undefined);
    const byTrack = track === 'all' ? dungeons : dungeons.filter((card) => normalizeGym(card).kind === track);
    const q = query.trim().toLowerCase();
    const filtered = q === ''
        ? byTrack
        : byTrack.filter((card) => card.name.toLowerCase().includes(q)
            || normalizeGym(card).scenarioId.toLowerCase().includes(q)
            || normalizeGym(card).period.toLowerCase().includes(q)
            || (card.gym?.protagonistNames ?? []).some((name) => name.toLowerCase().includes(q)));
    const countOf = (kind) => kind === 'all'
        ? dungeons.length
        : dungeons.filter((card) => normalizeGym(card).kind === kind).length;
    const tracks = [
        { id: 'all', label: t('stories.track.all', { count: countOf('all') }) },
        { id: 'history', label: t('stories.track.history', { count: countOf('history') }) },
        { id: 'contemporary', label: t('stories.track.contemporary', { count: countOf('contemporary') }) },
    ];
    return (_jsxs(Section, { title: t('stories.title'), description: t('stories.intro'), children: [state.status === 'loading' && _jsx(Skeleton, { height: 72 }), state.status === 'error' && _jsx(Err, { message: state.message }), state.status === 'ready' && dungeons.length === 0 && (_jsxs("div", { className: "dsh-tavern-empty", children: [_jsx("div", { className: "dsh-tavern-emptyTitle", children: t('stories.emptyTitle') }), _jsx("div", { className: "dsh-tavern-emptyDesc", children: t('stories.emptyDesc') })] })), dungeons.length > 0 && (_jsxs("div", { className: "dsh-tavern-storyBar", children: [_jsx(SearchInput, { label: t('stories.searchLabel'), value: query, onChange: setQuery, placeholder: t('stories.searchPlaceholder') }), _jsx("span", { className: "dsh-tavern-storyHowto", children: t('stories.searchHint') })] })), dungeons.length > 0 && (_jsx("div", { className: "dsh-tavern-tracks", children: tracks.map((item) => (_jsx("button", { type: "button", className: track === item.id ? 'dsh-tavern-track dsh-tavern-track--on' : 'dsh-tavern-track', onClick: () => setTrack(item.id), children: item.label }, item.id))) })), q !== '' && filtered.length === 0 && (_jsx(SearchEmpty, { what: t('stories.entity'), query: query.trim(), onClear: () => setQuery('') })), _jsx("div", { className: "dsh-tavern-list", children: filtered.map((card) => (_jsx(Dungeon, { card: card, open: openId === card.cardId, brief: briefs[card.cardId], busy: busyId === card.cardId, openPhase: openPhase, onPhase: setOpenPhase, onToggle: () => toggleDungeon(card.cardId) }, card.cardId))) })] }));
}
/** 一个副本：标题行 + 关卡链 + 可扮演位置。关卡与位置都只在展开后渲染。 */
function Dungeon(props) {
    const t = useT();
    const gym = normalizeGym(props.card);
    const roleKey = ROLE_KEY[gym.role];
    const levelCount = gym.phases.length;
    // 历史副本却没有关卡数 = 宿主跑的是旧投影。不能显示成「单关」，那是错的。
    const levelLabel = levelCount > 0
        ? t('stories.levels', { count: levelCount })
        : gym.kind === 'history' ? t('stories.levelsUnknown') : t('stories.singleLevel');
    return (_jsxs("div", { className: "dsh-tavern-storyItem", children: [_jsxs("div", { className: "dsh-tavern-tile dsh-tavern-storyTile dsh-tavern-dungeon", "aria-expanded": props.open, ...clickableProps(props.onToggle), children: [_jsxs("div", { className: "dsh-tavern-tileMain", children: [_jsxs("div", { className: "dsh-tavern-tileTitleRow", children: [gym.scenarioId ? _jsx("span", { className: "dsh-tavern-dungeonId", children: gym.scenarioId }) : null, _jsx("span", { className: "dsh-tavern-tileName", children: props.card.name }), _jsx(Badge, { accent: gym.kind === 'history', children: t(gym.kind === 'history' ? 'stories.kind.history' : 'stories.kind.contemporary') }), _jsx(Badge, { children: levelLabel }), gym.fidelity === '疑似虚构' ? _jsx(Badge, { accent: true, children: t('stories.fidelitySuspect') }) : null] }), gym.premise ? _jsx("span", { className: "dsh-tavern-tileSub", children: gym.premise }) : null, _jsxs("span", { className: "dsh-tavern-tileSub dsh-tavern-dungeonMeta", children: [gym.period ? `${gym.period}　·　` : '', t(roleKey ?? 'stories.role.general'), '　·　', t('stories.positions', { count: gym.protagonistCount }), gym.grade ? `　·　${t('stories.baseline', { grade: gym.grade })}` : ''] })] }), _jsx("div", { className: "dsh-tavern-tileActions", children: _jsx("span", { className: "dsh-tavern-storyToggle", children: t(props.open ? 'stories.collapseHint' : 'stories.expandHint') }) })] }), props.open && (_jsxs("div", { className: "dsh-tavern-storyBrief", children: [props.busy ? _jsx(Skeleton, { height: 48 }) : null, !props.busy && props.brief === null ? (_jsx("div", { className: "dsh-tavern-storyBriefLabel", children: t('stories.briefFailed') })) : null, props.brief ? (_jsxs(_Fragment, { children: [props.brief.briefing ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "dsh-tavern-chainTitle", children: t('stories.background') }), _jsxs("div", { className: "dsh-tavern-briefing", children: [props.brief.briefing.period ? (_jsxs("p", { className: "dsh-tavern-briefLine", children: [_jsx("span", { className: "dsh-tavern-briefKey", children: t('stories.bgPeriod') }), props.brief.briefing.period] })) : null, props.brief.briefing.stage ? (_jsxs("p", { className: "dsh-tavern-briefLine", children: [_jsx("span", { className: "dsh-tavern-briefKey", children: t('stories.bgStage') }), props.brief.briefing.stage] })) : null, props.brief.briefing.stakes ? (_jsxs("p", { className: "dsh-tavern-briefLine", children: [_jsx("span", { className: "dsh-tavern-briefKey", children: t('stories.bgStakes') }), props.brief.briefing.stakes] })) : null, props.brief.briefing.rules.length > 0 ? (_jsxs("div", { className: "dsh-tavern-storyBriefGroup", children: [_jsx("span", { className: "dsh-tavern-storyBriefLabel", children: t('stories.bgRules') }), _jsx("ul", { className: "dsh-tavern-storyBriefList", children: props.brief.briefing.rules.map((rule, i) => _jsx("li", { children: rule }, i)) })] })) : null, props.brief.briefing.clock ? (_jsxs("p", { className: "dsh-tavern-briefLine", children: [_jsx("span", { className: "dsh-tavern-briefKey", children: t('stories.bgClock') }), props.brief.briefing.clock] })) : null] })] })) : null, props.brief.howto ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "dsh-tavern-chainTitle", children: t('stories.howto') }), _jsxs("div", { className: "dsh-tavern-briefing", children: [_jsxs("p", { className: "dsh-tavern-briefLine", children: [_jsx("span", { className: "dsh-tavern-briefKey", children: t('stories.howtoTalk') }), props.brief.howto.talk] }), _jsxs("p", { className: "dsh-tavern-briefLine", children: [_jsx("span", { className: "dsh-tavern-briefKey", children: t('stories.howtoAdvance') }), props.brief.howto.advance] }), _jsxs("p", { className: "dsh-tavern-briefLine", children: [_jsx("span", { className: "dsh-tavern-briefKey", children: t('stories.howtoSettle') }), props.brief.howto.settle] })] })] })) : null, _jsx("span", { className: "dsh-tavern-chainTitle", children: t('stories.levelChain') }), props.brief.phases.length === 0 ? (_jsx("div", { className: "dsh-tavern-storyBriefLabel", children: gym.kind === 'history' ? t('stories.hostStale') : t('stories.noLevels') })) : (_jsx("div", { className: "dsh-tavern-chain", children: props.brief.phases.map((phase) => (_jsxs("div", { className: "dsh-tavern-levelWrap", children: [_jsxs("div", { className: props.openPhase === phase.id
                                                ? 'dsh-tavern-level dsh-tavern-level--on'
                                                : 'dsh-tavern-level', role: "button", tabIndex: 0, "aria-expanded": props.openPhase === phase.id, onClick: (event) => {
                                                // 关卡在副本行内部：不拦住冒泡，点关卡会连带把整个副本收起。
                                                event.stopPropagation();
                                                props.onPhase(props.openPhase === phase.id ? null : phase.id);
                                            }, onKeyDown: (event) => {
                                                if (event.key !== 'Enter' && event.key !== ' ')
                                                    return;
                                                event.preventDefault();
                                                event.stopPropagation();
                                                props.onPhase(props.openPhase === phase.id ? null : phase.id);
                                            }, children: [_jsx("span", { className: "dsh-tavern-levelNo", children: phase.id }), _jsx("span", { className: "dsh-tavern-levelName", children: phase.name }), phase.window ? _jsx("span", { className: "dsh-tavern-levelWindow", children: phase.window }) : null, _jsx("span", { className: "dsh-tavern-levelTasks", children: t('stories.taskCount', { count: phase.tasks.length }) })] }), props.openPhase === phase.id && (_jsxs("div", { className: "dsh-tavern-levelBody", children: [phase.situation ? _jsx("p", { className: "dsh-tavern-levelSituation", children: phase.situation }) : null, _jsxs("div", { className: "dsh-tavern-storyBriefGroup", children: [_jsx("span", { className: "dsh-tavern-storyBriefLabel", children: t('stories.levelTasks') }), _jsx("ul", { className: "dsh-tavern-storyBriefList", children: phase.tasks.map((task, i) => _jsx("li", { children: task }, i)) })] }), phase.focus ? (_jsxs("div", { className: "dsh-tavern-storyBriefGroup", children: [_jsx("span", { className: "dsh-tavern-storyBriefLabel", children: t('stories.levelFocus') }), _jsx("div", { className: "dsh-tavern-levelNote", children: phase.focus })] })) : null, phase.opponentMoves ? (_jsxs("div", { className: "dsh-tavern-storyBriefGroup", children: [_jsx("span", { className: "dsh-tavern-storyBriefLabel", children: t('stories.levelOpponent') }), _jsx("div", { className: "dsh-tavern-levelNote", children: phase.opponentMoves })] })) : null, phase.settleAt ? (_jsxs("div", { className: "dsh-tavern-storyBriefGroup", children: [_jsx("span", { className: "dsh-tavern-storyBriefLabel", children: t('stories.levelSettle') }), _jsx("div", { className: "dsh-tavern-levelNote", children: phase.settleAt })] })) : null] }))] }, phase.id))) })), _jsx("span", { className: "dsh-tavern-chainTitle", children: t('stories.roles') }), props.brief.protagonists.map((p) => {
                                const tone = p.difficulty === '地狱' ? 'hard' : p.difficulty === '困难' ? 'medium' : 'easy';
                                return (_jsxs("div", { className: "dsh-tavern-storyRole", children: [_jsxs("div", { className: "dsh-tavern-storyRoleHead", children: [_jsx("span", { className: "dsh-tavern-storyRoleName", children: p.name }), p.position ? _jsx("span", { className: "dsh-tavern-storyRolePos", children: p.position }) : null, _jsx("span", { className: `dsh-tavern-storyRoleDiff dsh-tavern-storyRoleDiff--${tone}`, children: p.difficulty }), _jsx("span", { className: p.grade ? 'dsh-tavern-storyGrade' : 'dsh-tavern-storyGrade dsh-tavern-storyGrade--none', children: p.grade ? t('stories.baseline', { grade: p.grade }) : t('stories.noGrade') })] }), p.goal ? _jsx("div", { className: "dsh-tavern-storyRoleGoal", children: p.goal }) : null, _jsx(BriefList, { label: t('stories.knows'), items: p.knows }), _jsx(BriefList, { label: t('stories.unaware'), items: p.unaware }), _jsx(BriefList, { label: t('stories.leverage'), items: p.leverage }), _jsx(BriefList, { label: t('stories.constraints'), items: p.constraints })] }, p.index));
                            })] })) : null] }))] }));
}
