export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      approvals: {
        Row: {
          code_hash: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          note: string | null
          org_id: string
          proposal_hash: string
          reasons: Json
          run_id: string
          status: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          org_id: string
          proposal_hash: string
          reasons: Json
          run_id: string
          status?: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          org_id?: string
          proposal_hash?: string
          reasons?: Json
          run_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          detail: Json
          id: string
          org_id: string
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          detail?: Json
          id?: string
          org_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          detail?: Json
          id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      destination_records: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          customer_reference: string
          evidence_level: string
          external_order_id: string
          id: string
          idempotency_key: string
          org_id: string
          quantity: number
          run_id: string | null
          sku: string
          source: string
          status: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency: string
          customer_reference: string
          evidence_level: string
          external_order_id: string
          id?: string
          idempotency_key: string
          org_id: string
          quantity: number
          run_id?: string | null
          sku: string
          source: string
          status?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          customer_reference?: string
          evidence_level?: string
          external_order_id?: string
          id?: string
          idempotency_key?: string
          org_id?: string
          quantity?: number
          run_id?: string | null
          sku?: string
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "destination_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "destination_records_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_events: {
        Row: {
          contract_ok: boolean
          evidence_level: string
          external_order_id: string | null
          id: string
          integration_id: string | null
          org_id: string
          payload: Json
          received_at: string
          signature_verified: boolean
          source: string
          violations: Json
        }
        Insert: {
          contract_ok: boolean
          evidence_level: string
          external_order_id?: string | null
          id?: string
          integration_id?: string | null
          org_id: string
          payload: Json
          received_at?: string
          signature_verified?: boolean
          source: string
          violations?: Json
        }
        Update: {
          contract_ok?: boolean
          evidence_level?: string
          external_order_id?: string | null
          id?: string
          integration_id?: string | null
          org_id?: string
          payload?: Json
          received_at?: string
          signature_verified?: boolean
          source?: string
          violations?: Json
        }
        Relationships: [
          {
            foreignKeyName: "inbound_events_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          attempts: number
          created_at: string
          event_id: string
          id: string
          org_id: string
          status: string
          updated_at: string
          violations: Json
        }
        Insert: {
          attempts?: number
          created_at?: string
          event_id: string
          id?: string
          org_id: string
          status?: string
          updated_at?: string
          violations?: Json
        }
        Update: {
          attempts?: number
          created_at?: string
          event_id?: string
          id?: string
          org_id?: string
          status?: string
          updated_at?: string
          violations?: Json
        }
        Relationships: [
          {
            foreignKeyName: "incidents_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "inbound_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_secrets: {
        Row: {
          integration_id: string
          secret: string
        }
        Insert: {
          integration_id: string
          secret: string
        }
        Update: {
          integration_id?: string
          secret?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_secrets_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: true
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          created_at: string
          id: string
          last_verified_at: string | null
          name: string
          org_id: string
          secret_hint: string
          source: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_verified_at?: string | null
          name: string
          org_id: string
          secret_hint: string
          source: string
        }
        Update: {
          created_at?: string
          id?: string
          last_verified_at?: string | null
          name?: string
          org_id?: string
          secret_hint?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      known_skus: {
        Row: {
          org_id: string
          sku: string
        }
        Insert: {
          org_id: string
          sku: string
        }
        Update: {
          org_id?: string
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "known_skus_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      provider_checks: {
        Row: {
          created_at: string
          detail: Json
          evidence_level: string
          id: string
          org_id: string
          provider: string
        }
        Insert: {
          created_at?: string
          detail: Json
          evidence_level: string
          id?: string
          org_id: string
          provider: string
        }
        Update: {
          created_at?: string
          detail?: Json
          evidence_level?: string
          id?: string
          org_id?: string
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_checks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          attempt: number
          code_hash: string | null
          created_at: string
          created_by: string
          egress: Json | null
          error: string | null
          exec_ms: number | null
          execution_status: string
          exit_code: number | null
          generated_code: string | null
          generation_log: Json
          generation_status: string
          id: string
          incident_id: string
          model: string | null
          org_id: string
          policy: Json | null
          proposed_record: Json | null
          sandbox_id: string | null
          sandbox_shape: string | null
          stderr: string | null
          stdout: string | null
        }
        Insert: {
          attempt: number
          code_hash?: string | null
          created_at?: string
          created_by: string
          egress?: Json | null
          error?: string | null
          exec_ms?: number | null
          execution_status?: string
          exit_code?: number | null
          generated_code?: string | null
          generation_log?: Json
          generation_status: string
          id?: string
          incident_id: string
          model?: string | null
          org_id: string
          policy?: Json | null
          proposed_record?: Json | null
          sandbox_id?: string | null
          sandbox_shape?: string | null
          stderr?: string | null
          stdout?: string | null
        }
        Update: {
          attempt?: number
          code_hash?: string | null
          created_at?: string
          created_by?: string
          egress?: Json | null
          error?: string | null
          exec_ms?: number | null
          execution_status?: string
          exit_code?: number | null
          generated_code?: string | null
          generation_log?: Json
          generation_status?: string
          id?: string
          incident_id?: string
          model?: string | null
          org_id?: string
          policy?: Json | null
          proposed_record?: Json | null
          sandbox_id?: string | null
          sandbox_shape?: string | null
          stderr?: string | null
          stdout?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "runs_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_receipts: {
        Row: {
          checks: Json
          created_at: string
          destination_record_id: string | null
          id: string
          org_id: string
          result: string
          run_id: string
          verifier_version: string
        }
        Insert: {
          checks: Json
          created_at?: string
          destination_record_id?: string | null
          id?: string
          org_id: string
          result: string
          run_id: string
          verifier_version: string
        }
        Update: {
          checks?: Json
          created_at?: string
          destination_record_id?: string | null
          id?: string
          org_id?: string
          result?: string
          run_id?: string
          verifier_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_receipts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_receipts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_operate: { Args: { _org: string }; Returns: boolean }
      create_organization: { Args: { _name: string }; Returns: string }
      decide_approval: {
        Args: { _approval: string; _decision: string; _note: string }
        Returns: undefined
      }
      is_member: { Args: { _org: string }; Returns: boolean }
      rotate_integration_secret: {
        Args: { _hint: string; _integration: string; _secret: string }
        Returns: undefined
      }
    }
    Enums: {
      org_role: "owner" | "operator" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      org_role: ["owner", "operator", "viewer"],
    },
  },
} as const