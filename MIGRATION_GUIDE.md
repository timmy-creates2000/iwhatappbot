# Database Migration for Rate Limiting

## Overview
Added rate limiting support to campaigns with a configurable delay between messages.

## Changes Made

### 1. Database Schema (`/workspace/lib/db/src/schema/campaigns.ts`)
- Added `delayBetweenMessages` column (integer, default: 1000ms)

### 2. API Schema (`/workspace/lib/api-zod/src/generated/api.ts`)
- Added `delayBetweenMessages` field to `CreateCampaignBody` (optional, min: 0, default: 1000)

### 3. Campaign Processor (`/workspace/artifacts/api-server/src/routes/campaigns/index.ts`)
- Updated campaign creation to accept and store `delayBetweenMessages`
- Modified message processor to use configurable delay with random jitter (±20%)
- Jitter makes traffic look more organic and helps avoid spam detection

## Migration Steps

You need to apply the schema change to your Turso database. Choose one of these approaches:

### Option A: Automatic Migration (Recommended)
Run this command from the workspace root:
```bash
cd /workspace/lib/db && pnpm run push
```

This will automatically detect the schema changes and apply them to your database.

### Option B: Manual SQL Migration
If you prefer manual control, run this SQL in your Turso console:
```sql
ALTER TABLE campaigns ADD COLUMN delay_between_messages INTEGER DEFAULT 1000;
```

## Usage

When creating a campaign via API, you can now specify the delay:

```json
{
  "name": "My Campaign",
  "messageTemplate": "Hello {{name}}!",
  "contactIds": [1, 2, 3],
  "delayBetweenMessages": 2000  // 2 seconds between messages
}
```

**Recommended values:**
- **Safe**: 2000-5000ms (2-5 seconds) - Best for avoiding bans
- **Moderate**: 1000-2000ms (1-2 seconds) - Good balance
- **Fast**: 500-1000ms (0.5-1 second) - Use with caution
- **Minimum**: 100ms - Only for testing

The system automatically adds ±20% random jitter to make the timing appear more natural.

## Important Notes

1. **Existing campaigns** will use the default 1000ms delay until updated
2. The delay is applied **after each message** is sent
3. Random jitter prevents detectable patterns that could trigger spam filters
4. Pausing/resuming campaigns preserves the configured delay
