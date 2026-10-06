/**
 * /rooms 荫房温湿度记录
 * 入房读数越界即标记关联道次「待复检」；调整环境后可对该记录补一次复测，
 * 复测读数另存档、第二次算数：道次待复检、超标次数与适宜占比均按最终判定（复测优先）。
 * 同器物同一天只保留一条复测，重录覆盖；复测仍越界时标注「复测阶段」。
 * 消费 Room、RoomRetest、Coat；复用 <FilterBar>、<StatBadge>、<EmptyPanel>。
 */
import { useMemo, useState } from 'react';
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, ExperimentOutlined } from '@ant-design/icons';
import EmptyPanel from '@/components/common/EmptyPanel';
import FilterBar, { useFilterQuery, type FilterSelectConfig } from '@/components/common/FilterBar';
import StatBadge from '@/components/common/StatBadge';
import { useBodyStore } from '@/stores/bodyStore';
import { useCoatStore } from '@/stores/coatStore';
import { useRoomStore } from '@/stores/roomStore';
import { useRoomRetestStore } from '@/stores/roomRetestStore';
import {
  ROOM_VERDICT_COLOR,
  ROOM_VERDICT_LABEL,
  ROOM_VERDICT_OPTIONS,
  createEmptyRoomDraft,
  type Room,
  type RoomDraft,
  type RoomVerdict,
} from '@/types/room';
import {
  createEmptyRetestDraft,
  effectiveRoomReading,
  effectiveRoomVerdict,
  type RoomRetest,
  type RoomRetestDraft,
} from '@/types/roomRetest';
import { BODY_SHAPE_LABEL } from '@/types/body';
import { dewPoint, dryingAdvice, dryingHours, judgeVerdict, rangeHint, roomStayHours } from '@/utils/humidity';

const FILTER_KEYS = ['verdict'] as const;

const FILTER_SELECTS: ReadonlyArray<FilterSelectConfig> = [
  { key: 'verdict', label: '判定', options: ROOM_VERDICT_OPTIONS },
];

export default function RoomLog() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<RoomDraft>();
  const [retestForm] = Form.useForm<RoomRetestDraft>();

  const bodies = useBodyStore((state) => state.bodies);
  const rooms = useRoomStore((state) => state.rooms);
  const createRoom = useRoomStore((state) => state.createRoom);
  const updateRoom = useRoomStore((state) => state.updateRoom);
  const removeRoom = useRoomStore((state) => state.removeRoom);
  const syncBodyRecheck = useRoomStore((state) => state.syncBodyRecheck);
  const coats = useCoatStore((state) => state.coats);
  const retests = useRoomRetestStore((state) => state.retests);
  const upsertRetest = useRoomRetestStore((state) => state.upsertRetest);
  const removeRetestByRoom = useRoomRetestStore((state) => state.removeRetestByRoom);

  const url = useFilterQuery(FILTER_KEYS);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [retestTarget, setRetestTarget] = useState<Room | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [draftTemp, setDraftTemp] = useState(24);
  const [draftHumidity, setDraftHumidity] = useState(75);
  const [retestTemp, setRetestTemp] = useState(24);
  const [retestHumidity, setRetestHumidity] = useState(75);

  const bodyCode = (bodyId: string): string => bodies.find((body) => body.id === bodyId)?.code ?? bodyId;

  const retestMap = useMemo(() => {
    const map = new Map<string, RoomRetest>();
    retests.forEach((item) => map.set(item.roomId, item));
    return map;
  }, [retests]);

  const retestOf = (room: Room): RoomRetest | undefined => retestMap.get(room.id);
  const finalVerdict = (room: Room): RoomVerdict => effectiveRoomVerdict(room, retestOf(room));

  const filtered = useMemo(() => {
    const keyword = url.keyword.trim();
    const verdicts = url.values.verdict ?? [];
    return rooms.filter((room) => {
      if (keyword.length > 0) {
        const reading = effectiveRoomReading(room, retestMap.get(room.id));
        const haystack = `${bodyCode(room.bodyId)}${room.date}${reading.tempC}${reading.humidityPct}`;
        if (!haystack.includes(keyword)) return false;
      }
      if (verdicts.length > 0 && !verdicts.includes(effectiveRoomVerdict(room, retestMap.get(room.id)))) return false;
      if (dateFrom.length > 0 && room.date < dateFrom) return false;
      if (dateTo.length > 0 && room.date > dateTo) return false;
      return true;
    });
  }, [rooms, url.keyword, url.values, dateFrom, dateTo, bodies, retestMap]);

  const stat = useMemo(() => {
    const total = rooms.length;
    const suitable = rooms.filter((room) => effectiveRoomVerdict(room, retestMap.get(room.id)) === 'suitable').length;
    const dry = rooms.filter((room) => effectiveRoomVerdict(room, retestMap.get(room.id)) === 'dry').length;
    const wet = rooms.filter((room) => effectiveRoomVerdict(room, retestMap.get(room.id)) === 'wet').length;
    // 平均湿度按最终读数（复测优先）
    const avgHumidity =
      total === 0
        ? 0
        : Math.round(
            rooms.reduce((sum, room) => sum + effectiveRoomReading(room, retestMap.get(room.id)).humidityPct, 0) / total,
          );
    return {
      total,
      suitable,
      dry,
      wet,
      over: dry + wet,
      suitablePercent: total === 0 ? 0 : Math.round((suitable / total) * 100),
      avgHumidity,
    };
  }, [rooms, retestMap]);

  const openCreate = (): void => {
    const bodyId = bodies[0]?.id ?? '';
    if (!bodyId) {
      message.warning('请先在胎体台账中登记胎体');
      return;
    }
    setEditing(null);
    const draft = createEmptyRoomDraft(bodyId);
    setDraftTemp(draft.tempC);
    setDraftHumidity(draft.humidityPct);
    form.setFieldsValue(draft);
    setOpen(true);
  };

  const openEdit = (room: Room): void => {
    setEditing(room);
    setDraftTemp(room.tempC);
    setDraftHumidity(room.humidityPct);
    form.setFieldsValue(room);
    setOpen(true);
  };

  const openRetest = (room: Room): void => {
    const existing = retestOf(room);
    setRetestTarget(room);
    if (existing) {
      setRetestTemp(existing.tempC);
      setRetestHumidity(existing.humidityPct);
      retestForm.setFieldsValue({
        roomId: room.id,
        tempC: existing.tempC,
        humidityPct: existing.humidityPct,
        retestInAt: existing.retestInAt,
        retestOutAt: existing.retestOutAt,
        operator: existing.operator,
      });
    } else {
      const draft = createEmptyRetestDraft(room);
      setRetestTemp(draft.tempC);
      setRetestHumidity(draft.humidityPct);
      retestForm.setFieldsValue(draft);
    }
  };

  const submit = async (): Promise<void> => {
    const values = await form.validateFields();
    const verdict = judgeVerdict(values.tempC, values.humidityPct);
    if (editing) {
      await updateRoom(editing.id, values);
      message.success(`已更新 ${values.date} 的荫房记录（入房判定：${ROOM_VERDICT_LABEL[verdict]}）`);
    } else {
      await createRoom(values);
      if (verdict === 'suitable') {
        message.success('已记录荫房温湿度，环境适宜');
      } else {
        message.warning(`入房判定为${ROOM_VERDICT_LABEL[verdict]}，已回写关联道次为待复检，可调环境后补复测`);
      }
    }
    setOpen(false);
  };

  const submitRetest = async (): Promise<void> => {
    if (!retestTarget) return;
    // roomId 无对应表单项（只读上下文），提交时显式补上
    const values: RoomRetestDraft = { ...(await retestForm.validateFields()), roomId: retestTarget.id };
    const verdict = judgeVerdict(values.tempC, values.humidityPct);
    const existed = retestOf(retestTarget) !== undefined;
    await upsertRetest(retestTarget, values);
    if (verdict === 'suitable') {
      message.success(`复测适宜，第二次读数算数${existed ? '（已覆盖原复测）' : ''}，已解除该胎体道次待复检`);
    } else {
      message.warning(`复测阶段仍判定为${ROOM_VERDICT_LABEL[verdict]}，道次维持待复检${existed ? '（已覆盖原复测）' : ''}`);
    }
    setRetestTarget(null);
  };

  const columns: ColumnsType<Room> = [
    { title: '日期', dataIndex: 'date', width: 110, sorter: (a, b) => a.date.localeCompare(b.date) },
    {
      title: '胎体',
      dataIndex: 'bodyId',
      width: 110,
      render: (value: string) => <Tag color="#8c2f1f">{bodyCode(value)}</Tag>,
    },
    { title: '入房温度', dataIndex: 'tempC', width: 90, render: (value: number) => `${value} ℃` },
    { title: '入房湿度', dataIndex: 'humidityPct', width: 90, render: (value: number) => `${value} %` },
    { title: '入房', dataIndex: 'inAt', width: 70 },
    { title: '出房', dataIndex: 'outAt', width: 70 },
    {
      title: '复测（第二次算数）',
      key: 'retest',
      width: 200,
      render: (_value, record) => {
        const retest = retestOf(record);
        if (!retest) {
          return (
            <Space size={4} wrap>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                未复测
              </Typography.Text>
              <Button size="small" type="link" icon={<ExperimentOutlined />} onClick={() => openRetest(record)}>
                补复测
              </Button>
            </Space>
          );
        }
        const retestOver = retest.verdict !== 'suitable';
        return (
          <Space size={4} direction="vertical">
            <Space size={4} wrap>
              <Tag color={ROOM_VERDICT_COLOR[retest.verdict]}>{ROOM_VERDICT_LABEL[retest.verdict]}</Tag>
              {retestOver ? <Tag color="red">复测阶段超标</Tag> : null}
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {retest.tempC}℃ / {retest.humidityPct}% · {retest.retestInAt}~{retest.retestOutAt} · {retest.operator || '复测人未填'}
            </Typography.Text>
            <Space size={2}>
              <Button size="small" type="link" style={{ paddingInline: 2 }} onClick={() => openRetest(record)}>
                重录
              </Button>
              <Popconfirm
                title="删除该条复测"
                description="删除后该记录退回按入房那次判定。"
                okText="确认"
                cancelText="取消"
                onConfirm={() =>
                  void removeRetestByRoom(record.id).then(() => message.success('已删除复测，退回入房判定'))
                }
              >
                <Button size="small" type="link" danger style={{ paddingInline: 2 }}>
                  删复测
                </Button>
              </Popconfirm>
            </Space>
          </Space>
        );
      },
    },
    {
      title: '判定',
      dataIndex: 'verdict',
      width: 150,
      filters: ROOM_VERDICT_OPTIONS.map((item) => ({ text: item.label, value: item.value })),
      onFilter: (value, record) => effectiveRoomVerdict(record, retestMap.get(record.id)) === value,
      render: (_value: RoomVerdict, record) => {
        const final = finalVerdict(record);
        const retest = retestOf(record);
        const reading = effectiveRoomReading(record, retest);
        return (
          <Space size={4} direction="vertical">
            <Space size={4} wrap>
              <Tag color={ROOM_VERDICT_COLOR[final]}>{ROOM_VERDICT_LABEL[final]}</Tag>
              {retest ? <Tag color="purple">按复测</Tag> : <Tag>按入房</Tag>}
            </Space>
            {retest && retest.verdict !== 'suitable' ? (
              <Tag color="red" style={{ marginInlineStart: 0 }}>
                复测阶段
              </Tag>
            ) : null}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              露点 {dewPoint(reading.tempC, reading.humidityPct)}℃
              {retest ? '' : ` · 在房 ${roomStayHours(record.inAt, record.outAt)} 小时`}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '荫干建议',
      key: 'advice',
      render: (_value, record) => {
        const { tempC, humidityPct } = effectiveRoomReading(record, retestOf(record));
        return (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {dryingAdvice(tempC, humidityPct, coats.find((coat) => coat.bodyId === record.bodyId)?.thicknessUm ?? 40)}
            （预计 {dryingHours(tempC, humidityPct, 40)} 小时）
          </Typography.Text>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 210,
      render: (_value, record) => {
        const over = finalVerdict(record) !== 'suitable';
        return (
          <Space size={4} wrap>
            <Button
              size="small"
              type="link"
              icon={<ReloadOutlined />}
              onClick={() =>
                void syncBodyRecheck(record.bodyId).then(() =>
                  message.success(over ? '已按最终判定回写待复检' : '已按最终判定清除该胎体待复检标记'),
                )
              }
            >
              同步待复检
            </Button>
            <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
              编辑
            </Button>
            <Popconfirm
              title="删除该荫房记录"
              description="其复测（如有）也会一并删除。"
              okText="确认"
              cancelText="取消"
              onConfirm={() => void removeRoom(record.id).then(() => message.success('已删除'))}
            >
              <Button size="small" type="link" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const previewVerdict = judgeVerdict(draftTemp, draftHumidity);
  const previewRetestVerdict = judgeVerdict(retestTemp, retestHumidity);

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h2>荫房温湿度记录</h2>
          <p>
            {rangeHint()}；入房越界先回写道次「待复检」，调整环境后复测一次，
            <strong>复测读数才算数</strong>。超标次数与适宜占比均按复测结论计，未复测按入房那次。
          </p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增记录
        </Button>
      </div>

      <div className="gb-stat-row">
        <StatBadge label="记录总数" value={stat.total} suffix="条" tone="primary" />
        <StatBadge label="适宜占比（按复测）" value={`${stat.suitablePercent}%`} percent={stat.suitablePercent} tone="success" />
        <StatBadge label="超标次数（按复测）" value={stat.over} suffix="次" tone="danger" />
        <StatBadge label="偏干" value={stat.dry} suffix="次" tone="warning" />
        <StatBadge label="偏湿" value={stat.wet} suffix="次" tone="info" />
        <StatBadge label="平均湿度（最终读数）" value={stat.avgHumidity} suffix="%" />
      </div>

      <FilterBar
        keyword={url.keyword}
        onKeywordChange={url.setKeyword}
        selects={FILTER_SELECTS}
        values={url.values}
        onValuesChange={url.setValues}
        onReset={() => {
          url.reset();
          setDateFrom('');
          setDateTo('');
        }}
        keywordPlaceholder="搜索编号 / 日期 / 最终温湿度…"
        actions={
          <Space size={6} wrap>
            <Input
              type="date"
              size="small"
              style={{ width: 150 }}
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
            <Typography.Text type="secondary">至</Typography.Text>
            <Input
              type="date"
              size="small"
              style={{ width: 150 }}
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </Space>
        }
      />

      <Card className="gb-table-card" style={{ marginTop: 16 }} styles={{ body: { padding: 0 } }}>
        {filtered.length === 0 ? (
          <EmptyPanel
            title={rooms.length === 0 ? '还没有荫房记录' : '当前条件下没有记录'}
            description={
              rooms.length === 0
                ? '每次入荫房时登记温度、湿度与出入房时间；越界可调环境后补复测，复测读数决定最终判定。'
                : '试着调整判定或日期区间。'
            }
            actionText="新增记录"
            onAction={openCreate}
            secondaryText="重置筛选"
            onSecondary={() => {
              url.reset();
              setDateFrom('');
              setDateTo('');
            }}
            size="small"
          />
        ) : (
          <Table<Room> rowKey="id" size="small" pagination={{ pageSize: 8 }} columns={columns} dataSource={filtered} />
        )}
      </Card>

      <Modal
        open={open}
        title={editing ? `编辑 ${editing.date} 的入房记录` : '新增荫房记录'}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false} onValuesChange={(changed) => {
          if (typeof changed.tempC === 'number') setDraftTemp(changed.tempC);
          if (typeof changed.humidityPct === 'number') setDraftHumidity(changed.humidityPct);
        }}>
          <Form.Item name="bodyId" label="关联胎体" rules={[{ required: true, message: '请选择胎体' }]}>
            <Select
              options={bodies.map((body) => ({
                value: body.id,
                label: `${body.code} · ${BODY_SHAPE_LABEL[body.shape]}`,
              }))}
            />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="date" label="记录日期" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="inAt" label="入房时间" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input type="time" />
            </Form.Item>
            <Form.Item name="outAt" label="出房时间" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input type="time" />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="tempC" label="温度（℃）" rules={[{ required: true }]} style={{ flex: 1 }}>
              <InputNumber min={5} max={45} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="humidityPct" label="湿度（%）" rules={[{ required: true }]} style={{ flex: 1 }}>
              <InputNumber min={10} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space direction="vertical" size={2}>
            <Tag color={ROOM_VERDICT_COLOR[previewVerdict]}>入房实时判定：{ROOM_VERDICT_LABEL[previewVerdict]}</Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              露点约 {dewPoint(draftTemp, draftHumidity)}℃ · 在房 {roomStayHours(form.getFieldValue('inAt') ?? '09:00', form.getFieldValue('outAt') ?? '21:00')} 小时
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {dryingAdvice(draftTemp, draftHumidity, 40)}
            </Typography.Text>
          </Space>
        </Form>
      </Modal>

      <Modal
        open={retestTarget !== null}
        title={retestTarget ? `复测 · ${bodyCode(retestTarget.bodyId)} ${retestTarget.date}` : '复测'}
        onCancel={() => setRetestTarget(null)}
        onOk={() => void submitRetest()}
        okText="保存复测"
        cancelText="取消"
        destroyOnClose
      >
        {retestTarget ? (
          <Form
            form={retestForm}
            layout="vertical"
            preserve={false}
            onValuesChange={(changed) => {
              if (typeof changed.tempC === 'number') setRetestTemp(changed.tempC);
              if (typeof changed.humidityPct === 'number') setRetestHumidity(changed.humidityPct);
            }}
          >
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={`入房读数：${retestTarget.tempC}℃ / ${retestTarget.humidityPct}%（${
                ROOM_VERDICT_LABEL[retestTarget.verdict]
              }）`}
              description="先调整荫房环境再测一次；同器物同一天只保留一条复测，重录覆盖。第二次读数决定最终判定与道次待复检。"
            />
            <Space size={12} style={{ display: 'flex' }}>
              <Form.Item name="retestInAt" label="复测入房时间" rules={[{ required: true, message: '请填写复测入房时间' }]} style={{ flex: 1 }}>
                <Input type="time" />
              </Form.Item>
              <Form.Item name="retestOutAt" label="复测出房时间" rules={[{ required: true, message: '请填写复测出房时间' }]} style={{ flex: 1 }}>
                <Input type="time" />
              </Form.Item>
              <Form.Item name="operator" label="复测人" rules={[{ required: true, message: '请填写复测人' }]} style={{ flex: 1 }}>
                <Input placeholder="如：王丽" />
              </Form.Item>
            </Space>
            <Space size={12} style={{ display: 'flex' }}>
              <Form.Item name="tempC" label="复测温度（℃）" rules={[{ required: true }]} style={{ flex: 1 }}>
                <InputNumber min={5} max={45} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="humidityPct" label="复测湿度（%）" rules={[{ required: true }]} style={{ flex: 1 }}>
                <InputNumber min={10} max={100} style={{ width: '100%' }} />
              </Form.Item>
            </Space>
            <Space size={4} wrap>
              <Tag color={ROOM_VERDICT_COLOR[previewRetestVerdict]}>
                复测实时判定：{ROOM_VERDICT_LABEL[previewRetestVerdict]}
              </Tag>
              {previewRetestVerdict !== 'suitable' ? <Tag color="red">复测阶段超标：道次维持待复检</Tag> : <Tag color="purple">复测适宜：解除待复检</Tag>}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                露点约 {dewPoint(retestTemp, retestHumidity)}℃
              </Typography.Text>
            </Space>
          </Form>
        ) : null}
      </Modal>
    </div>
  );
}
