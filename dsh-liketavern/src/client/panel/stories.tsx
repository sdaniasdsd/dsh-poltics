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
import { Component, useState, type ReactNode } from 'react'
import { gymMetaOf, type GymMeta } from '../gymProtagonists.js'
import { useT } from '../i18n.js'
import type { CharacterSummary, TavernRemote } from '../types.js'
import { Badge, Err, SearchEmpty, SearchInput, Section, Skeleton, clickableProps, useLoader } from '../util.js'

/**
 * 分区级错误边界。
 *
 * 面板里任何一处渲染抛异常，都会让整个挂载子树卸载——用户看到的就是白屏，
 * 而且拿不到任何线索。这一层把异常转成可读提示，把「白屏」变成「能报告的错误」。
 */
class SectionBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  override state: { error: string | null } = { error: null }

  static getDerivedStateFromError(cause: unknown): { error: string } {
    return { error: cause instanceof Error ? cause.message : String(cause) }
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return <Err message={`${this.state.error}`} />
    }
    return this.props.children
  }
}

/** role 取值 → 文案键。用字面量键，好让 i18n 测试能校验它们真的存在。 */
const ROLE_KEY: Record<string, string> = {
  sales: 'stories.role.sales',
  engineer: 'stories.role.engineer',
  procurement: 'stories.role.procurement',
  worker: 'stories.role.worker',
  history: 'stories.role.history',
  general: 'stories.role.general',
}

/** 简报里的一组条目；空数组整组不渲染，避免出现空标题。 */
function BriefList(props: { label: string; items: string[] }) {
  if (props.items.length === 0) return null
  return (
    <div className="dsh-tavern-storyBriefGroup">
      <span className="dsh-tavern-storyBriefLabel">{props.label}</span>
      <ul className="dsh-tavern-storyBriefList">
        {props.items.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
    </div>
  )
}

type Track = 'all' | 'history' | 'contemporary'

/**
 * 把 RPC 回来的副本摘要归一化。
 *
 * **不能因为 TypeScript 注解就信任运行期数据。** Node 侧的 state 层不随客户端热重载，
 * 宿主可能仍在跑旧版投影——那样 `kind` 与 `phases` 会整个缺失。
 * 缺字段一律按「未知」补空值，绝不在渲染里裸取属性（那会让整个面板白屏）。
 */
function normalizeGym(card: CharacterSummary) {
  const gym = card.gym!
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
  }
}

export function StoriesSection(props: { remote: TavernRemote }) {
  return (
    <SectionBoundary>
      <StoriesBody remote={props.remote} />
    </SectionBoundary>
  )
}

function StoriesBody(props: { remote: TavernRemote }) {
  const t = useT()
  const { state } = useLoader(() => props.remote.listCharacters({}), [])
  const [query, setQuery] = useState('')
  const [track, setTrack] = useState<Track>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [openPhase, setOpenPhase] = useState<number | null>(null)
  // 副本详情按 cardId 懒加载并缓存：展开过的不再拉第二次；null 表示拉失败。
  const [briefs, setBriefs] = useState<Record<string, GymMeta | null>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = async (cardId: string) => {
    if (briefs[cardId] !== undefined) return
    setBusyId(cardId)
    try {
      const result = await props.remote.getCharacterDetail({ cardId })
      // 用 .ok 判别式收窄，errOf 只给消息不做收窄。
      setBriefs((prev) => ({ ...prev, [cardId]: result.ok ? gymMetaOf(result.value) : null }))
    } catch {
      setBriefs((prev) => ({ ...prev, [cardId]: null }))
    } finally {
      setBusyId(null)
    }
  }

  const toggleDungeon = (cardId: string) => {
    if (openId === cardId) {
      setOpenId(null)
      setOpenPhase(null)
      return
    }
    setOpenId(cardId)
    setOpenPhase(null)
    void load(cardId)
  }

  const dungeons = (state.status === 'ready' ? state.value.items : []).filter((card) => card.gym !== undefined)
  const byTrack = track === 'all' ? dungeons : dungeons.filter((card) => normalizeGym(card).kind === track)
  const q = query.trim().toLowerCase()
  const filtered = q === ''
    ? byTrack
    : byTrack.filter((card) =>
        card.name.toLowerCase().includes(q)
        || normalizeGym(card).scenarioId.toLowerCase().includes(q)
        || normalizeGym(card).period.toLowerCase().includes(q)
        || (card.gym?.protagonistNames ?? []).some((name) => name.toLowerCase().includes(q)))

  const countOf = (kind: Track) => kind === 'all'
    ? dungeons.length
    : dungeons.filter((card) => normalizeGym(card).kind === kind).length

  const tracks: Array<{ id: Track; label: string }> = [
    { id: 'all', label: t('stories.track.all', { count: countOf('all') }) },
    { id: 'history', label: t('stories.track.history', { count: countOf('history') }) },
    { id: 'contemporary', label: t('stories.track.contemporary', { count: countOf('contemporary') }) },
  ]

  return (
    <Section title={t('stories.title')} description={t('stories.intro')}>
      {state.status === 'loading' && <Skeleton height={72} />}
      {state.status === 'error' && <Err message={state.message} />}
      {state.status === 'ready' && dungeons.length === 0 && (
        <div className="dsh-tavern-empty">
          <div className="dsh-tavern-emptyTitle">{t('stories.emptyTitle')}</div>
          <div className="dsh-tavern-emptyDesc">{t('stories.emptyDesc')}</div>
        </div>
      )}
      {dungeons.length > 0 && (
        <div className="dsh-tavern-storyBar">
          <SearchInput
            label={t('stories.searchLabel')}
            value={query}
            onChange={setQuery}
            placeholder={t('stories.searchPlaceholder')}
          />
          <span className="dsh-tavern-storyHowto">{t('stories.searchHint')}</span>
        </div>
      )}
      {dungeons.length > 0 && (
        <div className="dsh-tavern-tracks">
          {tracks.map((item) => (
            <button
              key={item.id}
              type="button"
              className={track === item.id ? 'dsh-tavern-track dsh-tavern-track--on' : 'dsh-tavern-track'}
              onClick={() => setTrack(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {q !== '' && filtered.length === 0 && (
        <SearchEmpty what={t('stories.entity')} query={query.trim()} onClear={() => setQuery('')} />
      )}
      <div className="dsh-tavern-list">
        {filtered.map((card) => (
          <Dungeon
            key={card.cardId}
            card={card}
            open={openId === card.cardId}
            brief={briefs[card.cardId]}
            busy={busyId === card.cardId}
            openPhase={openPhase}
            onPhase={setOpenPhase}
            onToggle={() => toggleDungeon(card.cardId)}
          />
        ))}
      </div>
    </Section>
  )
}

/** 一个副本：标题行 + 关卡链 + 可扮演位置。关卡与位置都只在展开后渲染。 */
function Dungeon(props: {
  card: CharacterSummary
  open: boolean
  brief: GymMeta | null | undefined
  busy: boolean
  openPhase: number | null
  onPhase: (id: number | null) => void
  onToggle: () => void
}) {
  const t = useT()
  const gym = normalizeGym(props.card)
  const roleKey = ROLE_KEY[gym.role]
  const levelCount = gym.phases.length
  // 历史副本却没有关卡数 = 宿主跑的是旧投影。不能显示成「单关」，那是错的。
  const levelLabel = levelCount > 0
    ? t('stories.levels', { count: levelCount })
    : gym.kind === 'history' ? t('stories.levelsUnknown') : t('stories.singleLevel')
  return (
    <div className="dsh-tavern-storyItem">
      <div
        className="dsh-tavern-tile dsh-tavern-storyTile dsh-tavern-dungeon"
        aria-expanded={props.open}
        {...clickableProps(props.onToggle)}
      >
        <div className="dsh-tavern-tileMain">
          <div className="dsh-tavern-tileTitleRow">
            {gym.scenarioId ? <span className="dsh-tavern-dungeonId">{gym.scenarioId}</span> : null}
            <span className="dsh-tavern-tileName">{props.card.name}</span>
            <Badge accent={gym.kind === 'history'}>
              {t(gym.kind === 'history' ? 'stories.kind.history' : 'stories.kind.contemporary')}
            </Badge>
            <Badge>{levelLabel}</Badge>
            {gym.fidelity === '疑似虚构' ? <Badge accent>{t('stories.fidelitySuspect')}</Badge> : null}
          </div>
          {gym.premise ? <span className="dsh-tavern-tileSub">{gym.premise}</span> : null}
          <span className="dsh-tavern-tileSub dsh-tavern-dungeonMeta">
            {gym.period ? `${gym.period}　·　` : ''}
            {t(roleKey ?? 'stories.role.general')}
            {'　·　'}
            {t('stories.positions', { count: gym.protagonistCount })}
            {gym.grade ? `　·　${t('stories.baseline', { grade: gym.grade })}` : ''}
          </span>
        </div>
        <div className="dsh-tavern-tileActions">
          <span className="dsh-tavern-storyToggle">
            {t(props.open ? 'stories.collapseHint' : 'stories.expandHint')}
          </span>
        </div>
      </div>
      {props.open && (
        <div className="dsh-tavern-storyBrief">
          {props.busy ? <Skeleton height={48} /> : null}
          {!props.busy && props.brief === null ? (
            <div className="dsh-tavern-storyBriefLabel">{t('stories.briefFailed')}</div>
          ) : null}
          {props.brief ? (
            <>
              {props.brief.briefing ? (
                <>
                  <span className="dsh-tavern-chainTitle">{t('stories.background')}</span>
                  <div className="dsh-tavern-briefing">
                    {props.brief.briefing.period ? (
                      <p className="dsh-tavern-briefLine">
                        <span className="dsh-tavern-briefKey">{t('stories.bgPeriod')}</span>
                        {props.brief.briefing.period}
                      </p>
                    ) : null}
                    {props.brief.briefing.stage ? (
                      <p className="dsh-tavern-briefLine">
                        <span className="dsh-tavern-briefKey">{t('stories.bgStage')}</span>
                        {props.brief.briefing.stage}
                      </p>
                    ) : null}
                    {props.brief.briefing.stakes ? (
                      <p className="dsh-tavern-briefLine">
                        <span className="dsh-tavern-briefKey">{t('stories.bgStakes')}</span>
                        {props.brief.briefing.stakes}
                      </p>
                    ) : null}
                    {props.brief.briefing.rules.length > 0 ? (
                      <div className="dsh-tavern-storyBriefGroup">
                        <span className="dsh-tavern-storyBriefLabel">{t('stories.bgRules')}</span>
                        <ul className="dsh-tavern-storyBriefList">
                          {props.brief.briefing.rules.map((rule, i) => <li key={i}>{rule}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {props.brief.briefing.clock ? (
                      <p className="dsh-tavern-briefLine">
                        <span className="dsh-tavern-briefKey">{t('stories.bgClock')}</span>
                        {props.brief.briefing.clock}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}
              {props.brief.howto ? (
                <>
                  <span className="dsh-tavern-chainTitle">{t('stories.howto')}</span>
                  <div className="dsh-tavern-briefing">
                    <p className="dsh-tavern-briefLine">
                      <span className="dsh-tavern-briefKey">{t('stories.howtoTalk')}</span>
                      {props.brief.howto.talk}
                    </p>
                    <p className="dsh-tavern-briefLine">
                      <span className="dsh-tavern-briefKey">{t('stories.howtoAdvance')}</span>
                      {props.brief.howto.advance}
                    </p>
                    <p className="dsh-tavern-briefLine">
                      <span className="dsh-tavern-briefKey">{t('stories.howtoSettle')}</span>
                      {props.brief.howto.settle}
                    </p>
                  </div>
                </>
              ) : null}
              <span className="dsh-tavern-chainTitle">{t('stories.levelChain')}</span>
              {props.brief.phases.length === 0 ? (
                <div className="dsh-tavern-storyBriefLabel">
                  {gym.kind === 'history' ? t('stories.hostStale') : t('stories.noLevels')}
                </div>
              ) : (
                <div className="dsh-tavern-chain">
                  {props.brief.phases.map((phase) => (
                    <div key={phase.id} className="dsh-tavern-levelWrap">
                      <div
                        className={props.openPhase === phase.id
                          ? 'dsh-tavern-level dsh-tavern-level--on'
                          : 'dsh-tavern-level'}
                        role="button"
                        tabIndex={0}
                        aria-expanded={props.openPhase === phase.id}
                        onClick={(event) => {
                          // 关卡在副本行内部：不拦住冒泡，点关卡会连带把整个副本收起。
                          event.stopPropagation()
                          props.onPhase(props.openPhase === phase.id ? null : phase.id)
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          event.stopPropagation()
                          props.onPhase(props.openPhase === phase.id ? null : phase.id)
                        }}
                      >
                        <span className="dsh-tavern-levelNo">{phase.id}</span>
                        <span className="dsh-tavern-levelName">{phase.name}</span>
                        {phase.window ? <span className="dsh-tavern-levelWindow">{phase.window}</span> : null}
                        <span className="dsh-tavern-levelTasks">
                          {t('stories.taskCount', { count: phase.tasks.length })}
                        </span>
                      </div>
                      {props.openPhase === phase.id && (
                        <div className="dsh-tavern-levelBody">
                          {phase.situation ? <p className="dsh-tavern-levelSituation">{phase.situation}</p> : null}
                          <div className="dsh-tavern-storyBriefGroup">
                            <span className="dsh-tavern-storyBriefLabel">{t('stories.levelTasks')}</span>
                            <ul className="dsh-tavern-storyBriefList">
                              {phase.tasks.map((task, i) => <li key={i}>{task}</li>)}
                            </ul>
                          </div>
                          {phase.focus ? (
                            <div className="dsh-tavern-storyBriefGroup">
                              <span className="dsh-tavern-storyBriefLabel">{t('stories.levelFocus')}</span>
                              <div className="dsh-tavern-levelNote">{phase.focus}</div>
                            </div>
                          ) : null}
                          {phase.opponentMoves ? (
                            <div className="dsh-tavern-storyBriefGroup">
                              <span className="dsh-tavern-storyBriefLabel">{t('stories.levelOpponent')}</span>
                              <div className="dsh-tavern-levelNote">{phase.opponentMoves}</div>
                            </div>
                          ) : null}
                          {phase.settleAt ? (
                            <div className="dsh-tavern-storyBriefGroup">
                              <span className="dsh-tavern-storyBriefLabel">{t('stories.levelSettle')}</span>
                              <div className="dsh-tavern-levelNote">{phase.settleAt}</div>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <span className="dsh-tavern-chainTitle">{t('stories.roles')}</span>
              {props.brief.protagonists.map((p) => {
                const tone = p.difficulty === '地狱' ? 'hard' : p.difficulty === '困难' ? 'medium' : 'easy'
                return (
                  <div key={p.index} className="dsh-tavern-storyRole">
                    <div className="dsh-tavern-storyRoleHead">
                      <span className="dsh-tavern-storyRoleName">{p.name}</span>
                      {p.position ? <span className="dsh-tavern-storyRolePos">{p.position}</span> : null}
                      <span className={`dsh-tavern-storyRoleDiff dsh-tavern-storyRoleDiff--${tone}`}>{p.difficulty}</span>
                      <span className={p.grade ? 'dsh-tavern-storyGrade' : 'dsh-tavern-storyGrade dsh-tavern-storyGrade--none'}>
                        {p.grade ? t('stories.baseline', { grade: p.grade }) : t('stories.noGrade')}
                      </span>
                    </div>
                    {p.goal ? <div className="dsh-tavern-storyRoleGoal">{p.goal}</div> : null}
                    <BriefList label={t('stories.knows')} items={p.knows} />
                    <BriefList label={t('stories.unaware')} items={p.unaware} />
                    <BriefList label={t('stories.leverage')} items={p.leverage} />
                    <BriefList label={t('stories.constraints')} items={p.constraints} />
                  </div>
                )
              })}
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
