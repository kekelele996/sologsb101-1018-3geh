/**
 * /rooms 荫房温湿度记录
 * 按区间判定适宜度并回写关联道次为「待复检」，支持日期区间与判定筛选（同步 URL query）。
 * 复测另存一份：判定列保留入房判定并并列展示复测判定（复测仍越界标「复测阶段」），
 * 超标次数 / 适宜占比 / 待复检回写均按有效判定（有复测按复测，没复测按入房）。
 * 消费 Room、Coat；复用 <FilterBar>、<StatBadge>、<EmptyPanel>。
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  App as AntdApp,
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
import { DeleteOutlined, EditOutlined, ExperimentOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import EmptyPanel from '@/components/common/EmptyPanel';
import FilterBar, { useFilterQuery, type FilterSelectConfig } from '@/components/common/FilterBar';
import StatBadge from '@/components/common/StatBadge';
import { useBodyStore } from '@/stores/bodyStore';
import { useCoatStore } from '@/stores/coatStore';
import { useRoomStore } from '@/stores/roomStore';
import {
  ROOM_VERDICT_COLOR,
  ROOM_VERDICT_LABEL,
  ROOM_VERDICT_OPTIONS,
  createEmptyRemeasureDraft,
  createEmptyRoomDraft,
  effectiveReading,
  effectiveVerdict,
  type Room,
  type RoomDraft,
  type RoomRemeasureDraft,
  type RoomVerdict,
} from '@/types/room';
import { BODY_SHAPE_LABEL } from '@/types/body';
import { dewPoint, dryingAdvice, dryingHours, judgeVerdict, rangeHint, roomStayHours } from '@/utils/humidity';

const FILTER_KEYS = ['verdict'] as const;

const FILTER_SELECTS: ReadonlyArray<FilterSelectConfig> = [
  { key: 'verdict', label: '有效判定', options: ROOM_VERDICT_OPTIONS },
];

export default function RoomLog() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<RoomDraft>();
  const [remeasureForm] = Form.useForm<RoomRemeasureDraft>();

  const bodies = useBodyStore((state) => state.bodies);
  const rooms = useRoomStore((state) => state.rooms);
  const createRoom = useRoomStore((state) => state.createRoom);
  const updateRoom = useRoomStore((state) => state.updateRoom);
  const removeRoom = useRoomStore((state) => state.removeRoom);
  const saveRemeasure = useRoomStore((state) => state.saveRemeasure);
  const markRecheck = useCoatStore((state) => state.markRecheck);
  const coats = useCoatStore((state) => state.coats);

  const url = useFilterQuery(FILTER_KEYS);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [draftTemp, setDraftTemp] = useState(24);
  const [draftHumidity, setDraftHumidity] = useState(75);
  const [remeasureTarget, setRemeasureTarget] = useState<Room | null>(null);
  const [remeasureTemp, setRemeasureTemp] = useState(24);
  const [remeasureHumidity, setRemeasureHumidity] = useState(75);

  const bodyCode = (bodyId: string): string => bodies.find((body) => body.id === bodyId)?.code ?? bodyId;

  const filtered = useMemo(() => {
    const keyword = url.keyword.trim();
    const verdicts = url.values.verdict ?? [];
    return rooms.filter((room) => {
      if (keyword.length > 0) {
        const haystack = `${bodyCode(room.bodyId)}${room.date}${room.tempC}${room.humidityPct}${room.remeasure?.operator ?? ''}`;
        if (!haystack.includes(keyword)) return false;
      }
      // 判定筛选按有效判定：有复测按复测结论，没复测按入房那次
      if (verdicts.length > 0 && !verdicts.includes(effectiveVerdict(room))) return false;
      if (dateFrom.length > 0 && room.date < dateFrom) return false;
      if (dateTo.length > 0 && room.date > dateTo) return false;
      return true;
    });
  }, [rooms, url.keyword, url.values, dateFrom, dateTo, bodies]);

  const stat = useMemo(() => {
    const total = rooms.length;
    const verdicts = rooms.map((room) => effectiveVerdict(room));
    const suitable = verdicts.filter((verdict) => verdict === 'suitable').length;
    const dry = verdicts.filter((verdict) => verdict === 'dry').length;
    const wet = verdicts.filter((verdict) => verdict === 'wet').length;
    const remeasured = rooms.filter((room) => room.remeasure).length;
    const remeasureOver = rooms.filter((room) => room.remeasure != null && room.remeasure.verdict !== 'suitable').length;
    const avgHumidity =
      total === 0 ? 0 : Math.round(rooms.reduce((sum, room) => sum + effectiveReading(room).humidityPct, 0) / total);
    return {
      total,
      suitable,
      dry,
      wet,
      over: dry + wet,
      suitablePercent: total === 0 ? 0 : Math.round((suitable / total) * 100),
      avgHumidity,
      remeasured,
      remeasureOver,
    };
  }, [rooms]);

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

  const submit = async (): Promise<void> => {
    const values = await form.validateFields();
    const verdict = judgeVerdict(values.tempC, values.humidityPct);
    if (editing) {
      await updateRoom(editing.id, values);
      message.success(`已更新 ${values.date} 的荫房记录（判定：${ROOM_VERDICT_LABEL[verdict]}）`);
    } else {
      await createRoom(values);
      if (verdict === 'suitable') {
        message.success('已记录荫房温湿度，环境适宜');
      } else {
        message.warning(`判定为${ROOM_VERDICT_LABEL[verdict]}，已回写关联道次为待复检`);
      }
    }
    setOpen(false);
  };

  const openRemeasure = (room: Room): void => {
    setRemeasureTarget(room);
    // 重录覆盖：已有复测则带出上次数值，否则以入房读数为起点
    const draft = room.remeasure ?? createEmptyRemeasureDraft(room);
    setRemeasureTemp(draft.tempC);
    setRemeasureHumidity(draft.humidityPct);
    remeasureForm.setFieldsValue(draft);
  };

  const submitRemeasure = async (): Promise<void> => {
    if (!remeasureTarget) return;
    const values = await remeasureForm.validateFields();
    const saved = await saveRemeasure(remeasureTarget.id, values);
    const verdict = saved?.remeasure?.verdict ?? judgeVerdict(values.tempC, values.humidityPct);
    if (verdict === 'suitable') {
      message.success('复测适宜，超标统计与道次待复检已按复测结论更新');
    } else {
      message.warning(`复测仍为${ROOM_VERDICT_LABEL[verdict]}，已标记复测阶段越界并回写道次待复检`);
    }
    setRemeasureTarget(null);
  };

  const remeasurePreview = judgeVerdict(remeasureTemp, remeasureHumidity);
  const siblingRemeasured = remeasureTarget
    ? rooms.some(
        (room) =>
          room.id !== remeasureTarget.id &&
          room.bodyId === remeasureTarget.bodyId &&
          room.date === remeasureTarget.date &&
          room.remeasure,
      )
    : false;

  const columns: ColumnsType<Room> = [
    { title: '日期', dataIndex: 'date', width: 120, sorter: (a, b) => a.date.localeCompare(b.date) },
    {
      title: '胎体',
      dataIndex: 'bodyId',
      width: 120,
      render: (value: string) => <Tag color="#8c2f1f">{bodyCode(value)}</Tag>,
    },
    { title: '温度', dataIndex: 'tempC', width: 90, render: (value: number) => `${value} ℃` },
    { title: '湿度', dataIndex: 'humidityPct', width: 90, render: (value: number) => `${value} %` },
    { title: '入房', dataIndex: 'inAt', width: 90 },
    { title: '出房', dataIndex: 'outAt', width: 90 },
    {
      title: '在房时长',
      key: 'stay',
      width: 110,
      render: (_value, record) => `${roomStayHours(record.inAt, record.outAt)} 小时`,
    },
    {
      title: '判定',
      dataIndex: 'verdict',
      width: 210,
      filters: ROOM_VERDICT_OPTIONS.map((item) => ({ text: item.label, value: item.value })),
      onFilter: (value, record) => effectiveVerdict(record) === value,
      render: (value: RoomVerdict, record) => (
        <Space size={4} wrap>
          <Tag color={ROOM_VERDICT_COLOR[value]}>入房·{ROOM_VERDICT_LABEL[value]}</Tag>
          {record.remeasure ? (
            <Tag color={record.remeasure.verdict === 'suitable' ? ROOM_VERDICT_COLOR.suitable : '#b03a2e'}>
              {record.remeasure.verdict === 'suitable'
                ? '复测·适宜'
                : `复测阶段·${ROOM_VERDICT_LABEL[record.remeasure.verdict]}`}
            </Tag>
          ) : null}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            露点 {dewPoint(record.tempC, record.humidityPct)}℃
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '复测',
      key: 'remeasure',
      width: 200,
      filters: [
        { text: '已复测', value: 'yes' },
        { text: '未复测', value: 'no' },
      ],
      onFilter: (value, record) => (value === 'yes') === (record.remeasure != null),
      render: (_value, record) =>
        record.remeasure ? (
          <Space direction="vertical" size={0}>
            <Typography.Text style={{ fontSize: 12 }}>
              {record.remeasure.tempC}℃ / {record.remeasure.humidityPct}% · {record.remeasure.inAt}–
              {record.remeasure.outAt}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              复测人 {record.remeasure.operator || '未填写'}
            </Typography.Text>
          </Space>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            未复测
          </Typography.Text>
        ),
    },
    {
      title: '荫干建议',
      key: 'advice',
      render: (_value, record) => {
        const reading = effectiveReading(record);
        return (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {dryingAdvice(reading.tempC, reading.humidityPct, coats.find((coat) => coat.bodyId === record.bodyId)?.thicknessUm ?? 40)}
            （预计 {dryingHours(reading.tempC, reading.humidityPct, 40)} 小时）
          </Typography.Text>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 300,
      render: (_value, record) => (
        <Space size={4} wrap>
          <Button size="small" type="link" icon={<ExperimentOutlined />} onClick={() => openRemeasure(record)}>
            {record.remeasure ? '重录复测' : '复测'}
          </Button>
          <Button
            size="small"
            type="link"
            icon={<ReloadOutlined />}
            onClick={() =>
              void markRecheck(record.bodyId, effectiveVerdict(record) !== 'suitable').then(() =>
                message.success(effectiveVerdict(record) === 'suitable' ? '已清除该胎体待复检标记' : '已回写待复检'),
              )
            }
          >
            回写道次
          </Button>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="删除该荫房记录"
            okText="确认"
            cancelText="取消"
            onConfirm={() => void removeRoom(record.id).then(() => message.success('已删除'))}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const previewVerdict = judgeVerdict(draftTemp, draftHumidity);

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h2>荫房温湿度记录</h2>
          <p>{rangeHint()}；越界可调环境后复测一次，复测结论决定超标统计与道次「待复检」，原记录保留入房判定。</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增记录
        </Button>
      </div>

      <div className="gb-stat-row">
        <StatBadge label="记录总数" value={stat.total} suffix="条" tone="primary" />
        <StatBadge label="适宜占比" value={`${stat.suitablePercent}%`} percent={stat.suitablePercent} tone="success" />
        <StatBadge label="超标次数" value={stat.over} suffix="次" tone="danger" />
        <StatBadge label="偏干" value={stat.dry} suffix="次" tone="warning" />
        <StatBadge label="偏湿" value={stat.wet} suffix="次" tone="info" />
        <StatBadge label="已复测" value={stat.remeasured} suffix="条" tone="primary" />
        <StatBadge label="复测仍超标" value={stat.remeasureOver} suffix="条" tone="danger" />
        <StatBadge label="平均湿度" value={stat.avgHumidity} suffix="%" />
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
        keywordPlaceholder="搜索编号 / 日期 / 温湿度 / 复测人…"
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
                ? '每次入荫房时登记温度、湿度与出入房时间，判定结果会自动回写道次。'
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
        title={editing ? `编辑 ${editing.date} 的荫房记录` : '新增荫房记录'}
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
            <Tag color={ROOM_VERDICT_COLOR[previewVerdict]}>实时判定：{ROOM_VERDICT_LABEL[previewVerdict]}</Tag>
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
        open={remeasureTarget !== null}
        title={remeasureTarget ? `复测 ${remeasureTarget.date} 的荫房记录` : '复测'}
        onCancel={() => setRemeasureTarget(null)}
        onOk={() => void submitRemeasure()}
        okText="保存复测"
        cancelText="取消"
        destroyOnClose
      >
        {remeasureTarget ? (
          <>
            <Alert
              type={remeasureTarget.remeasure ? 'warning' : 'info'}
              showIcon
              style={{ marginBottom: 12 }}
              message={`入房 ${remeasureTarget.tempC}℃ / ${remeasureTarget.humidityPct}%（${ROOM_VERDICT_LABEL[remeasureTarget.verdict]}），调环境后再测一次，第二次的数才算数。`}
              description={
                siblingRemeasured
                  ? '注意：该器物同一天已有另一条记录登记过复测，保存后那条复测将被清除。'
                  : '同器物同一天只保留一条复测，重复保存将覆盖上次数值。'
              }
            />
            <Form
              form={remeasureForm}
              layout="vertical"
              preserve={false}
              onValuesChange={(changed) => {
                if (typeof changed.tempC === 'number') setRemeasureTemp(changed.tempC);
                if (typeof changed.humidityPct === 'number') setRemeasureHumidity(changed.humidityPct);
              }}
            >
              <Form.Item name="operator" label="复测人" rules={[{ required: true, message: '请填写复测人' }]}>
                <Input placeholder="复测人姓名" />
              </Form.Item>
              <Space size={12} style={{ display: 'flex' }}>
                <Form.Item name="inAt" label="复测入房时间" rules={[{ required: true }]} style={{ flex: 1 }}>
                  <Input type="time" />
                </Form.Item>
                <Form.Item name="outAt" label="复测出房时间" rules={[{ required: true }]} style={{ flex: 1 }}>
                  <Input type="time" />
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
              <Space direction="vertical" size={2}>
                <Tag color={ROOM_VERDICT_COLOR[remeasurePreview]}>
                  复测判定：{ROOM_VERDICT_LABEL[remeasurePreview]}
                </Tag>
                {remeasurePreview === 'suitable' ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    保存后该记录按复测适宜计入统计，并清除关联道次待复检。
                  </Typography.Text>
                ) : (
                  <Typography.Text type="danger" style={{ fontSize: 12 }}>
                    复测仍越界，保存后将标记为「复测阶段」越界，道次维持待复检。
                  </Typography.Text>
                )}
              </Space>
            </Form>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
