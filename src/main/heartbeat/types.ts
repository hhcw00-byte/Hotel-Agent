/** 调度类型 */
export type ScheduleType = 'interval' | 'fixed-time';

/** 间隔模式配置 */
export interface IntervalConfig {
  value: number;                 // 间隔数值
  unit: 'minutes' | 'hours';    // 间隔单位
}

/** 固定时间模式配置 */
export interface FixedTimeConfig {
  times: string[];               // 时间点列表，格式 "HH:mm"，如 ["08:00", "14:00"]
}

/** 调度配置（联合类型） */
export type ScheduleConfig = IntervalConfig | FixedTimeConfig;

export interface HeartbeatTask {
  id: string;           // 任务唯一标识
  skill: string;        // SKILL 名称（backend-pricing 等）
  platform: string;     // 平台标识，如 "pms", "meituan", "ctrip", "fliggy", "booking"
  cron: string;         // Cron 表达式
  enabled: boolean;     // 是否启用
  params?: Record<string, any>;  // 直接传给 skill 的参数
  lastExecutedAt?: number;
  scheduleType: ScheduleType;       // 调度类型（必填）
  scheduleConfig: ScheduleConfig;   // 调度配置（必填）
}

export interface TaskSchedule {
  tasks: HeartbeatTask[];
}

export interface TaskExecutionLog {
  taskId: string;
  skill: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  error?: string;
}

/** 平台组定义 */
export interface PlatformGroup {
  platform: string;
  tasks: HeartbeatTask[];
}

/** 并发执行轮次结果 */
export interface ConcurrentRoundResult {
  roundId: string;
  platformResults: Map<string, PlatformExecutionResult>;
  totalDuration: number;
  allSucceeded: boolean;
}

/** 单个平台组执行结果 */
export interface PlatformExecutionResult {
  platform: string;
  taskResults: TaskExecutionResult[];
  duration: number;
  success: boolean;
}

/** 单个任务执行结果 */
export interface TaskExecutionResult {
  taskId: string;
  sessionId: string;
  jsonFilePath: string;
  success: boolean;
  duration: number;
  error?: string;
}
