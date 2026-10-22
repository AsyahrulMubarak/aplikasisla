// Compatibility for browser sessions opened before the Supabase cutover.
// Executes the same Supabase implementation and never calls GAS.
import '../sla-operations/index.ts';
