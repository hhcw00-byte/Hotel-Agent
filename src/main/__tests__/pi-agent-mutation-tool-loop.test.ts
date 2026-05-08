jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => process.cwd()),
    getAppPath: jest.fn(() => process.cwd())
  }
}));

jest.mock('../../../database/dist/database-manager', () => ({
  databaseManager: {
    getSessions: jest.fn(async () => []),
    createSession: jest.fn(async () => undefined),
    getHotelConfig: jest.fn(async () => null)
  }
}));

import { PiAgentManager } from '../pi-agent-manager';

describe('PiAgentManager mutation tool loop guard', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stops the tool loop for a Ctrip-style smart-price-adjust success result', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'smart-price-adjust', ctripPayload()));
    const skillManager = buildSkillManagerMock(smartSuccess('ctrip'));
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('run ctrip price adjustment');

    expectStoppedReply(response);
    expect(create).toHaveBeenCalledTimes(1);
    expect(skillManager.executeSkill).toHaveBeenCalledTimes(1);
    expectConsoleErrorContains('mutation tool finished');
  });

  it('requires a tool decision for explicit price adjustment triggers', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'smart-price-adjust', ctripPayload()));
    const skillManager = buildSkillManagerMock(smartSuccess('ctrip'));
    const manager = buildManager(create, skillManager);

    await (manager as any).callOpenAIAPI('携程豪华单人间 5月18号放价改成 380');

    expect(create.mock.calls[0][0].tool_choice).toBe('required');
    expect(skillManager.executeSkill).toHaveBeenCalledTimes(1);
  });

  it('stops the tool loop for a Trip-style smart-price-adjust segmentResults success result', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'smart-price-adjust', tripPayload()));
    const skillManager = buildSkillManagerMock({
      success: true,
      output: {
        success: true,
        data: {
          ok: true,
          platformCode: 'trip',
          summary: {
            totalSegments: 4,
            successSegments: 4,
            submittedSegments: 4
          },
          segmentResults: [
            { success: true, submitted: true },
            { success: true, submitted: true }
          ]
        }
      },
      executionTime: 1,
      format: 'json'
    });
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('run trip price adjustment');

    expectStoppedReply(response);
    expect(create).toHaveBeenCalledTimes(1);
    expect(skillManager.executeSkill).toHaveBeenCalledTimes(1);
    expectConsoleErrorContains('mutation tool finished');
  });

  it('reports successful and failed Ctrip segments when one segment fails after submit', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'smart-price-adjust', ctripPayload()));
    const skillManager = buildSkillManagerMock({
      success: true,
      output: {
        data: {
          platformCode: 'ctrip',
          summary: {
            totalSegments: 2,
            successSegments: 1,
            failedSegments: 1,
            submittedSegments: 1,
            stopped: true
          },
          segmentResults: [
            {
              segmentIndex: 0,
              startDate: '2026-05-18',
              endDate: '2026-05-18',
              ok: true,
              success: true,
              submitted: true,
              roomResults: [{ roomName: '豪华单人间', price: '391', ok: true }]
            },
            {
              segmentIndex: 1,
              startDate: '2026-05-21',
              endDate: '2026-05-21',
              ok: false,
              success: false,
              failure: {
                code: 'ROOM_NOT_FOUND',
                stage: 'match_room',
                message: 'Ctrip room not found: 精品单人间'
              },
              roomResults: [{ roomName: '精品单人间', price: '344', ok: false, message: 'Ctrip room not found: 精品单人间' }]
            }
          ]
        }
      },
      executionTime: 1,
      format: 'json'
    });
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('run trip price adjustment');

    expect(response).toContain('改价部分成功');
    expect(response).toContain('执行概况：平台：ctrip，总段数：2，成功：1 段，失败：1 段，已提交：1 段');
    expect(response).toContain('已成功：');
    expect(response).toContain('成功段 1（2026-05-18 ~ 2026-05-18）：豪华单人间 -> ¥391');
    expect(response).toContain('未成功：');
    expect(response).toContain('失败段 2（2026-05-21 ~ 2026-05-21）：精品单人间 -> ¥344：match_room - Ctrip room not found: 精品单人间');
    expect(response).not.toContain('改价成功');
    expect(create).toHaveBeenCalledTimes(1);
    expect(skillManager.executeSkill).toHaveBeenCalledTimes(1);
    expectConsoleErrorContains('ok=false');
    expectConsoleErrorContains('detectedPath=');
  });

  it('reports partial failure from smart-price-adjust terminal text when JSON parsing is unavailable', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'smart-price-adjust', {
        platformCode: 'ctrip',
        segments: [
          { startDate: '2026-05-18', endDate: '2026-05-18', roomList: [{ roomName: '豪华单人间', price: '391' }] },
          { startDate: '2026-05-21', endDate: '2026-05-21', roomList: [{ roomName: '精品单人间', price: '344' }] }
        ]
      }))
      .mockResolvedValueOnce(stopCompletion('model hallucinated success'));
    const skillManager = buildSkillManagerMock({
      success: true,
      output: [
        '[进度] Ctrip 第 1/2 段：选择房型',
        '[进度] Ctrip 第 1/2 段：选择日期 2026-05-18 ~ 2026-05-18',
        '[进度] Ctrip 第 1/2 段：提交成功',
        '[进度] Ctrip 第 1/2 段：完成',
        '[进度] Ctrip 第 2/2 段：开始',
        '[进度] Ctrip 第 2/2 段：选择房型',
        '[失败] Ctrip 第 2/2 段：match_room - Ctrip room not found: 精品单人间'
      ].join('\n'),
      executionTime: 1,
      format: 'text'
    });
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('run ctrip price adjustment');

    expect(response).toContain('Ctrip 改价部分成功：成功 1 段，失败 1 段');
    expect(response).toContain('成功段 1（2026-05-18 ~ 2026-05-18）：豪华单人间 -> ¥391');
    expect(response).toContain('失败段 2：精品单人间 -> ¥344：match_room - Ctrip room not found: 精品单人间');
    expect(response).not.toContain('model hallucinated success');
    expect(create).toHaveBeenCalledTimes(1);
    expect(skillManager.executeSkill).toHaveBeenCalledTimes(1);
    expectConsoleErrorContains('ok=false');
  });

  it('stops the tool loop when smart-price-adjust output is a JSON string success', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'smart-price-adjust', tripPayload()));
    const skillManager = buildSkillManagerMock({
      success: true,
      output: JSON.stringify({
        ok: true,
        platformCode: 'trip',
        summary: { submittedSegments: 4, successSegments: 4 }
      }),
      executionTime: 1,
      format: 'text'
    });
    const manager = buildManager(create, skillManager);

    await (manager as any).callOpenAIAPI('run trip price adjustment');

    expect(create).toHaveBeenCalledTimes(1);
    expectConsoleErrorContains('detectedPath=');
  });

  it('stops the tool loop when smart-price-adjust output is mixed text ending with JSON success', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'smart-price-adjust', ctripPayload()));
    const skillManager = buildSkillManagerMock({
      success: true,
      output: [
        '[进度] Ctrip 第 1/1 段：完成',
        JSON.stringify({
          success: true,
          data: {
            ok: true,
            platformCode: 'ctrip',
            message: '携程改价成功',
            summary: { submittedSegments: 1, successSegments: 1 }
          }
        })
      ].join('\n'),
      executionTime: 1,
      format: 'text'
    });
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('run ctrip price adjustment');

    expectStoppedReply(response);
    expect(create).toHaveBeenCalledTimes(1);
    expectConsoleErrorContains('detectedSuccessPath=result.output.parsed.success');
  });

  it('stops the tool loop when smart-price-adjust stdout is empty but stderr shows segment completion', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'smart-price-adjust', ctripPayload()));
    const skillManager = buildSkillManagerMock({
      success: true,
      output: null,
      executionTime: 1,
      format: 'text',
      stdout: '',
      stderr: [
        '[进度] Ctrip 第 1/1 段：开始',
        '[进度] Ctrip 第 1/1 段：选择房型',
        '[进度] Ctrip 第 1/1 段：完成'
      ].join('\n')
    });
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('run ctrip price adjustment');

    expect(response).toContain('改价成功');
    expect(create).toHaveBeenCalledTimes(1);
    expectConsoleErrorContains('detectedSuccessPath=result.stderr.segmentCompleted');
  });

  it('stops the tool loop when smart-price-adjust reports partialSubmitted=true', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'smart-price-adjust', tripPayload()));
    const skillManager = buildSkillManagerMock({
      success: true,
      output: {
        success: false,
        data: {
          ok: false,
          platformCode: 'trip',
          partialSubmitted: true,
          summary: { submittedSegments: 1, successSegments: 1 }
        }
      },
      executionTime: 1,
      format: 'json'
    });
    const manager = buildManager(create, skillManager);

    await (manager as any).callOpenAIAPI('run partial trip price adjustment');

    expect(create).toHaveBeenCalledTimes(1);
    expectConsoleErrorContains('ok=false');
    expectConsoleErrorContains('detectedPath=');
  });

  it('stops the tool loop for a Meituan smart-price-adjust success result', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallsCompletion([
        ['call_1', 'smart-price-adjust', platformPayload('meituan')],
        ['call_2', 'check_platform_logins', { platforms: ['booking'] }]
      ]));
    const skillManager = buildSkillManagerMock(smartOutput(platformSuccessOutput('meituan')));
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('run meituan price adjustment');

    expectStoppedReply(response);
    expect(create).toHaveBeenCalledTimes(1);
    expect(skillManager.executeSkill).toHaveBeenCalledTimes(1);
    expect(skillManager.checkPlatformLogins).toHaveBeenCalledTimes(1);
    expect(skillManager.checkPlatformLogins).toHaveBeenCalledWith(['meituan']);
    expectConsoleErrorContains('mutation tool finished');
  });

  it('stops the tool loop for a Booking smart-price-adjust success result', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallsCompletion([
        ['call_1', 'smart-price-adjust', platformPayload('booking')],
        ['call_2', 'check_platform_logins', { platforms: ['ctrip'] }]
      ]));
    const skillManager = buildSkillManagerMock(smartOutput(platformSuccessOutput('booking')));
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('run booking price adjustment');

    expectStoppedReply(response);
    expect(create).toHaveBeenCalledTimes(1);
    expect(skillManager.executeSkill).toHaveBeenCalledTimes(1);
    expect(skillManager.checkPlatformLogins).toHaveBeenCalledTimes(1);
    expect(skillManager.checkPlatformLogins).toHaveBeenCalledWith(['booking']);
    expectConsoleErrorContains('mutation tool finished');
  });

  it('stops the tool loop for future smart-price-adjust platforms', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'smart-price-adjust', platformPayload('future-platform')));
    const skillManager = buildSkillManagerMock(smartOutput({
      success: true,
      data: {
        ok: true,
        platformCode: 'future-platform',
        summary: { submittedSegments: 1 }
      }
    }));
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('run future platform price adjustment');

    expectStoppedReply(response);
    expect(response).toContain('future-platform');
    expect(create).toHaveBeenCalledTimes(1);
    expect(skillManager.executeSkill).toHaveBeenCalledTimes(1);
    expectConsoleErrorContains('mutation tool finished');
  });

  it('stops the tool loop for batch platformResults success', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallsCompletion([
        ['call_1', 'smart-price-adjust', { tasks: [platformPayload('ctrip'), platformPayload('meituan')] }],
        ['call_2', 'check_platform_logins', { platforms: ['booking'] }]
      ]));
    const skillManager = buildSkillManagerMock(smartOutput({
      success: true,
      data: {
        ok: true,
        platformResults: [
          {
            platformCode: 'ctrip',
            success: true,
            summary: { submittedSegments: 1 }
          },
          {
            platformCode: 'meituan',
            success: true,
            summary: { submittedSegments: 1 }
          }
        ]
      }
    }));
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('run batch price adjustment');

    expectStoppedReply(response);
    expect(create).toHaveBeenCalledTimes(1);
    expect(skillManager.executeSkill).toHaveBeenCalledTimes(1);
    expect(skillManager.checkPlatformLogins).not.toHaveBeenCalled();
    expectConsoleErrorContains('mutation tool finished');
  });

  it('stops as failed from platformResults with explicit failed top-level flags', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'smart-price-adjust', { tasks: [platformPayload('meituan')] }));
    const skillManager = buildSkillManagerMock(smartOutput({
      success: false,
      data: {
        ok: false,
        platformResults: [
          {
            platformCode: 'meituan',
            summary: { submittedSegments: 1 }
          }
        ]
      }
    }));
    const manager = buildManager(create, skillManager);

    await (manager as any).callOpenAIAPI('run batch partial price adjustment');

    expect(create).toHaveBeenCalledTimes(1);
    expect(skillManager.executeSkill).toHaveBeenCalledTimes(1);
    expectConsoleErrorContains('ok=false');
    expectConsoleErrorContains('detectedPath=');
  });

  it('stops the tool loop when Booking reports partialSubmitted=true', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'smart-price-adjust', platformPayload('booking')));
    const skillManager = buildSkillManagerMock(smartOutput({
      success: false,
      data: {
        ok: false,
        partialSubmitted: true,
        platformCode: 'booking',
        summary: {
          submittedSegments: 1,
          failedSegments: 1
        }
      }
    }));
    const manager = buildManager(create, skillManager);

    await (manager as any).callOpenAIAPI('run partial booking price adjustment');

    expect(create).toHaveBeenCalledTimes(1);
    expect(skillManager.executeSkill).toHaveBeenCalledTimes(1);
    expectConsoleErrorContains('ok=false');
    expectConsoleErrorContains('detectedPath=');
  });

  it('stops the tool loop for a Meituan no-submit failure without retrying real adjustment', async () => {
    const payload = platformPayload('meituan');
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'smart-price-adjust', payload))
      .mockResolvedValueOnce(toolCallCompletion('call_2', 'smart-price-adjust', payload))
      .mockResolvedValueOnce(stopCompletion('meituan failure handled'));
    const skillManager = buildSkillManagerMock(smartOutput({
      success: false,
      data: {
        ok: false,
        platformCode: 'meituan',
        summary: {
          submittedSegments: 0,
          successSegments: 0
        }
      }
    }));
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('run failing meituan price adjustment');

    expect(response).toContain('改价失败');
    expect(response).toContain('改价失败');
    expect(create).toHaveBeenCalledTimes(1);
    expect(skillManager.executeSkill).toHaveBeenCalledTimes(1);
    expectConsoleErrorContains('ok=false');
  });

  it('does not execute later check_platform_logins after smart-price-adjust succeeds in the same tool batch', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallsCompletion([
        ['call_1', 'smart-price-adjust', tripPayload()],
        ['call_2', 'check_platform_logins', { platforms: ['trip'] }]
      ]));
    const skillManager = buildSkillManagerMock(smartSuccess('trip'));
    const manager = buildManager(create, skillManager);

    await (manager as any).callOpenAIAPI('run trip price adjustment');

    expect(create).toHaveBeenCalledTimes(1);
    expect(skillManager.executeSkill).toHaveBeenCalledTimes(1);
    expect(skillManager.checkPlatformLogins).toHaveBeenCalledTimes(1);
  });

  it('stops immediately for smart-price-adjust failure instead of asking for duplicate fallback', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'smart-price-adjust', ctripPayload()))
      .mockResolvedValueOnce(toolCallCompletion('call_2', 'smart-price-adjust', ctripPayload()))
      .mockResolvedValueOnce(stopCompletion('duplicate blocked'));
    const skillManager = buildSkillManagerMock(smartFailureNoSubmit());
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('run ctrip price adjustment');

    expect(response).toContain('failed before submit');
    expect(response).toContain('failed before submit');
    expect(create).toHaveBeenCalledTimes(1);
    expect(skillManager.executeSkill).toHaveBeenCalledTimes(1);
    expectConsoleErrorContains('ok=false');
  });

  it('does not stop the loop for read-only login-check', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'login-check', { platforms: ['ctrip'] }))
      .mockResolvedValueOnce(stopCompletion('login checked'));
    const skillManager = buildSkillManagerMock({
      success: true,
      output: { success: true, data: { allLoggedIn: true } },
      executionTime: 1,
      format: 'json'
    });
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('check login');

    expect(response).toBe('login checked');
    expect(create).toHaveBeenCalledTimes(2);
    expect(skillManager.executeSkill).toHaveBeenCalledWith(
      'login-check',
      expect.objectContaining({ platforms: ['ctrip'] }),
      expect.any(Function)
    );
  });

  it('does not stop the loop for check_platform_logins', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'check_platform_logins', { platforms: ['trip'] }))
      .mockResolvedValueOnce(stopCompletion('platform login checked'));
    const skillManager = buildSkillManagerMock(smartSuccess('trip'));
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('check platform login');

    expect(response).toBe('platform login checked');
    expect(create).toHaveBeenCalledTimes(2);
    expect(skillManager.executeSkill).not.toHaveBeenCalled();
    expect(skillManager.checkPlatformLogins).toHaveBeenCalledTimes(1);
  });

  it('does not stop the loop for load_skill', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'load_skill', { skill_name: 'ordinary-skill' }))
      .mockResolvedValueOnce(stopCompletion('skill loaded'));
    const skillManager = buildSkillManagerMock(smartSuccess('trip'));
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('load a skill');

    expect(response).toBe('skill loaded');
    expect(create).toHaveBeenCalledTimes(2);
    expect(skillManager.executeSkill).not.toHaveBeenCalled();
  });

  it('does not stop the loop for ordinary non-mutation tools', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'ordinary-skill', { query: 'hello' }))
      .mockResolvedValueOnce(stopCompletion('ordinary done'));
    const skillManager = buildSkillManagerMock({
      success: true,
      output: { success: true, data: { answer: 1 } },
      executionTime: 1,
      format: 'json'
    });
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('run ordinary skill');

    expect(response).toBe('ordinary done');
    expect(create).toHaveBeenCalledTimes(2);
    expect(skillManager.executeSkill).toHaveBeenCalledWith(
      'ordinary-skill',
      expect.objectContaining({ query: 'hello' }),
      expect.any(Function)
    );
  });

  it('stops the loop for smart-price-adjust failure without submitted markers', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce(toolCallCompletion('call_1', 'smart-price-adjust', tripPayload()))
      .mockResolvedValueOnce(stopCompletion('failure handled'));
    const skillManager = buildSkillManagerMock(smartFailureNoSubmit());
    const manager = buildManager(create, skillManager);

    const response = await (manager as any).callOpenAIAPI('run failing trip price adjustment');

    expect(response).toContain('failed before submit');
    expect(response).toContain('failed before submit');
    expect(create).toHaveBeenCalledTimes(1);
    expect(skillManager.executeSkill).toHaveBeenCalledTimes(1);
  });
});

function expectStoppedReply(response: string): void {
  expect(response).toMatch(/执行概况|改价成功|price adjust succeeded/);
}

function expectConsoleErrorContains(text: string): void {
  const calls = (console.error as jest.Mock).mock.calls as unknown[][];
  const combinedLogs = calls
    .map((args: unknown[]) => args.map((arg: unknown) => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '))
    .join('\n');
  expect(combinedLogs).toContain(text);
}

function buildManager(create: jest.Mock, skillManager: any): PiAgentManager {
  const manager = new PiAgentManager({
    provider: 'openai',
    model: 'mock-model',
    apiKey: 'test-key',
    baseURL: 'http://127.0.0.1',
    temperature: 0,
    maxTokens: 1000
  } as any);
  (manager as any).openaiClient = {
    chat: {
      completions: { create }
    }
  };
  (manager as any).skillManager = skillManager;
  return manager;
}

function buildSkillManagerMock(result: any): any {
  const skills = [
    { status: 'loaded', metadata: { name: 'smart-price-adjust', type: 'tool', description: 'mock submit tool', parameters: {} }, content: '' },
    { status: 'loaded', metadata: { name: 'login-check', type: 'tool', description: 'mock readonly tool', parameters: {} }, content: '' },
    { status: 'loaded', metadata: { name: 'ordinary-skill', type: 'tool', description: 'mock ordinary tool', parameters: {} }, content: 'ordinary instructions' }
  ];
  return {
    getAvailableSkills: jest.fn(() => skills),
    getEnabledSkills: jest.fn(() => skills),
    checkPlatformLogins: jest.fn(async () => ({ allLoggedIn: true, notLoggedIn: [] })),
    executeSkill: jest.fn(async () => result),
    getSkill: jest.fn((name: string) => skills.find((skill) => skill.metadata.name === name) || null)
  };
}

function smartSuccess(platformCode: string): any {
  return {
    success: true,
    output: {
      success: true,
      data: {
        ok: true,
        platformCode,
        message: `${platformCode} price adjust succeeded`,
        summary: { submittedSegments: 4, successSegments: 4 }
      }
    },
    executionTime: 1,
    format: 'json'
  };
}

function smartFailureNoSubmit(): any {
  return {
    success: true,
    output: {
      success: false,
      data: { ok: false, message: 'failed before submit' }
    },
    executionTime: 1,
    format: 'json'
  };
}

function smartOutput(output: any): any {
  return {
    success: true,
    output,
    executionTime: 1,
    format: 'json'
  };
}

function platformSuccessOutput(platformCode: string): any {
  return {
    success: true,
    data: {
      ok: true,
      platformCode,
      summary: {
        totalSegments: 2,
        successSegments: 2,
        submittedSegments: 2
      },
      segmentResults: [
        { success: true, submitted: true },
        { success: true, submitted: true }
      ]
    }
  };
}

function ctripPayload(): any {
  return {
    platformCode: 'ctrip',
    segments: [
      {
        startDate: '2026-05-25',
        endDate: '2026-05-25',
        roomList: [{ roomName: 'A', price: '392' }]
      }
    ]
  };
}

function tripPayload(): any {
  return {
    platformCode: 'trip',
    segments: [
      {
        startDate: '2026-05-25',
        endDate: '2026-05-25',
        roomList: [{ roomName: 'A', price: '391' }]
      }
    ]
  };
}

function platformPayload(platformCode: string): any {
  return {
    platformCode,
    segments: [
      {
        startDate: '2026-05-25',
        endDate: '2026-05-25',
        roomList: [{ roomName: 'A', price: '388' }]
      }
    ]
  };
}

function toolCallCompletion(id: string, name: string, args: any): any {
  return toolCallsCompletion([[id, name, args]]);
}

function toolCallsCompletion(calls: Array<[string, string, any]>): any {
  return {
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: calls.map(([id, name, args]) => ({
          id,
          type: 'function',
          function: {
            name,
            arguments: JSON.stringify(args)
          }
        }))
      }
    }]
  };
}

function stopCompletion(content: string): any {
  return {
    choices: [{
      finish_reason: 'stop',
      message: {
        role: 'assistant',
        content
      }
    }]
  };
}
