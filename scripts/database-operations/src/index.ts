import { databaseManager } from '../../../database/dist/database-manager';

interface OperationParams {
  operation: string;
  data?: any;
  query?: any;
}

/** 操作名称的中文映射 */
const operationLabels: Record<string, string> = {
  get_competitors: '查询竞品列表',
  set_competitor_platform_id: '设置竞品平台hotelId',
  batch_set_competitor_platform_ids: '批量设置竞品平台hotelId',
  get_pricing_data: '获取智能调价数据（房态+本店价格+竞品价格）',
};

function emitProgress(message: string, phase: string = 'extracting'): void {
  const event = { type: 'progress', phase, message };
  console.log(JSON.stringify(event));
}

function requirePositiveId(value: any, name: string): number {
  const num = typeof value === 'string' ? parseInt(value) : value;
  if (!num || isNaN(num) || num <= 0) {
    throw new Error(`${name} 必须为正整数（>0），当前值: ${value}`);
  }
  return num;
}

async function main() {
  try {
    const paramsJson = process.argv[2];
    if (!paramsJson) {
      throw new Error('缺少操作参数');
    }

    const params: OperationParams = JSON.parse(paramsJson);
    const opLabel = operationLabels[params.operation] || params.operation;

    emitProgress(`数据库操作: ${opLabel}`, 'connecting');

    // 从环境变量注入数据库配置（子进程场景）
    if (process.env.DB_HOST && process.env.DB_USER_ID) {
      databaseManager.setConfig(
        {
          host: process.env.DB_HOST,
          port: parseInt(process.env.DB_PORT || '3306', 10),
          user: process.env.DB_USER || 'root',
          password: process.env.DB_PASSWORD || '',
        },
        parseInt(process.env.DB_USER_ID, 10)
      );
    }

    await databaseManager.initialize();
    emitProgress(`数据库已连接，正在执行: ${opLabel}`, 'extracting');

    let result: any;

    switch (params.operation) {

      // ==================== 竞品管理 ====================
      case 'get_competitors': {
        const competitors = await databaseManager.getCompetitorHotels();
        result = { success: true, data: competitors };
        emitProgress(`查询完成，共 ${competitors.length} 个竞品`, 'extracting');
        break;
      }

      case 'set_competitor_platform_id': {
        const competitorId = requirePositiveId(params.data?.competitorId, 'competitorId');
        if (!params.data?.platform || !params.data?.platformHotelId) {
          throw new Error('缺少必要参数: competitorId, platform, platformHotelId');
        }
        await databaseManager.setCompetitorPlatformId(competitorId, params.data.platform, params.data.platformHotelId, params.data.platformHotelName);
        result = { success: true, message: `竞品 ${competitorId} 的 ${params.data.platform} hotelId 已设置为 ${params.data.platformHotelId}` };
        break;
      }

      case 'batch_set_competitor_platform_ids': {
        if (!Array.isArray(params.data?.records) || params.data.records.length === 0) {
          throw new Error('缺少必要参数: data.records (非空数组)');
        }
        const records = params.data.records.map((r: any) => ({
          competitorId: requirePositiveId(r.competitorId, 'competitorId'),
          platform: r.platform,
          platformHotelId: r.platformHotelId,
          platformHotelName: r.platformHotelName || undefined,
        }));
        const { savedCount } = await databaseManager.batchSetCompetitorPlatformIds(records);
        result = { success: true, message: `批量写入 ${savedCount} 条竞品平台ID`, savedCount };
        break;
      }

      // ==================== 智能调价聚合查询 ====================
      case 'get_pricing_data': {
        const pricingData = await databaseManager.getPricingData(params.query);
        // 诊断：写文件记录实际返回数据量
        try {
          const fs = require('fs');
          const path = require('path');
          const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
          fs.writeFileSync(path.join(dataDir, 'pricing-data-diag.json'), JSON.stringify({
            timestamp: new Date().toISOString(),
            query: params.query,
            roomSnapshotsCount: pricingData.roomSnapshots.length,
            ownPricesCount: pricingData.ownPrices.length,
            competitorPricesCount: pricingData.competitorPrices.length,
            roomSnapshotsSample: pricingData.roomSnapshots.slice(0, 3),
            ownPricesSample: pricingData.ownPrices.slice(0, 3),
            competitorPricesSample: pricingData.competitorPrices.slice(0, 3),
          }, null, 2));
        } catch {}
        result = {
          success: true,
          data: pricingData,
          summary: {
            roomSnapshots: pricingData.roomSnapshots.length,
            ownPrices: pricingData.ownPrices.length,
            competitorPrices: pricingData.competitorPrices.length,
          }
        };
        emitProgress(`调价数据查询完成: 房态${pricingData.roomSnapshots.length}条, 本店价格${pricingData.ownPrices.length}条, 竞品价格${pricingData.competitorPrices.length}条`, 'extracting');
        break;
      }

      default:
        throw new Error(`未知操作类型: ${params.operation}`);
    }

    emitProgress(`${opLabel} 完成`, 'extracting');
    console.log(JSON.stringify(result));
    await databaseManager.close();
    process.exit(0);
  } catch (error) {
    const errorResult = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
    console.log(JSON.stringify(errorResult));
    console.error(`[database-operations] 错误: ${errorResult.error}`);
    try { await databaseManager.close(); } catch (_) {}
    process.exit(1);
  }
}

main();
