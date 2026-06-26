import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';

export const SUPABASE_CLIENT = 'SUPABASE_CLIENT';

export const supabaseClientFactory = {
  provide: SUPABASE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): SupabaseClient => {
    const url = config.get<string>('SUPABASE_URL');
    const key = config.get<string>('SUPABASE_ANON_KEY');
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
    return createClient(url, key);
  },
};
