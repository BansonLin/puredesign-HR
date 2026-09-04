// 手寫，T30 前以 gen types 取代。
//
// Hand-written to match supabase/migrations/20260904020001…20260904020010 exactly
// (tables, columns, nullability, defaults, enums, foreign keys), in the shape that
// `supabase gen types typescript` emits, so `pnpm db:types` can overwrite this file
// without touching any caller. Generation could not run in this container: the CLI's
// `gen types --db-url` needs the Docker daemon (pg-meta container) and there is no
// Supabase project key. Regenerate with `pnpm db:types` (local stack) before T30.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      alerts: {
        Row: {
          id: string;
          submission_id: string;
          user_id: string;
          rule_key: string;
          detail: Json;
          status: Database["public"]["Enums"]["alert_status"];
          created_at: string;
          responded_at: string | null;
          response_submission_id: string | null;
          closed_at: string | null;
          closed_by: string | null;
          closed_reason: string | null;
        };
        Insert: {
          id?: string;
          submission_id: string;
          user_id: string;
          rule_key: string;
          detail?: Json;
          status?: Database["public"]["Enums"]["alert_status"];
          created_at?: string;
          responded_at?: string | null;
          response_submission_id?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          closed_reason?: string | null;
        };
        Update: {
          id?: string;
          submission_id?: string;
          user_id?: string;
          rule_key?: string;
          detail?: Json;
          status?: Database["public"]["Enums"]["alert_status"];
          created_at?: string;
          responded_at?: string | null;
          response_submission_id?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          closed_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "alerts_closed_by_fkey";
            columns: ["closed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "alerts_response_submission_id_fkey";
            columns: ["response_submission_id"];
            isOneToOne: false;
            referencedRelation: "submissions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "alerts_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "submissions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "alerts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          id: string;
          actor_id: string;
          action: string;
          entity: string;
          entity_id: string;
          before: Json | null;
          after: Json | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id: string;
          action: string;
          entity: string;
          entity_id: string;
          before?: Json | null;
          after?: Json | null;
          reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_id?: string;
          action?: string;
          entity?: string;
          entity_id?: string;
          before?: Json | null;
          after?: Json | null;
          reason?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      departments: {
        Row: {
          id: string;
          name: string;
          sort_order: number;
        };
        Insert: {
          id?: string;
          name: string;
          sort_order?: number;
        };
        Update: {
          id?: string;
          name?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      form_templates: {
        Row: {
          id: string;
          key: string;
          name: string;
          description: string | null;
          target_role: Database["public"]["Enums"]["form_target_role"];
          active_version_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          name: string;
          description?: string | null;
          target_role: Database["public"]["Enums"]["form_target_role"];
          active_version_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          key?: string;
          name?: string;
          description?: string | null;
          target_role?: Database["public"]["Enums"]["form_target_role"];
          active_version_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "form_templates_active_version_fkey";
            columns: ["active_version_id", "id"];
            isOneToOne: false;
            referencedRelation: "form_versions";
            referencedColumns: ["id", "template_id"];
          },
        ];
      };
      form_versions: {
        Row: {
          id: string;
          template_id: string;
          version_no: number;
          status: Database["public"]["Enums"]["form_version_status"];
          questions: Json;
          change_note: string | null;
          published_at: string | null;
          published_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          template_id: string;
          version_no: number;
          status?: Database["public"]["Enums"]["form_version_status"];
          questions?: Json;
          change_note?: string | null;
          published_at?: string | null;
          published_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          template_id?: string;
          version_no?: number;
          status?: Database["public"]["Enums"]["form_version_status"];
          questions?: Json;
          change_note?: string | null;
          published_at?: string | null;
          published_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "form_versions_published_by_fkey";
            columns: ["published_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_versions_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "form_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      milestones: {
        Row: {
          id: string;
          user_id: string;
          kind: Database["public"]["Enums"]["milestone_kind"];
          due_date: string;
          done_at: string | null;
          interviewer_id: string | null;
          notes: string | null;
          outcome: Database["public"]["Enums"]["milestone_outcome"] | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          kind: Database["public"]["Enums"]["milestone_kind"];
          due_date: string;
          done_at?: string | null;
          interviewer_id?: string | null;
          notes?: string | null;
          outcome?: Database["public"]["Enums"]["milestone_outcome"] | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          kind?: Database["public"]["Enums"]["milestone_kind"];
          due_date?: string;
          done_at?: string | null;
          interviewer_id?: string | null;
          notes?: string | null;
          outcome?: Database["public"]["Enums"]["milestone_outcome"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "milestones_interviewer_id_fkey";
            columns: ["interviewer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "milestones_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string;
          role: Database["public"]["Enums"]["user_role"];
          department_id: string | null;
          manager_id: string | null;
          start_date: string | null;
          status: Database["public"]["Enums"]["profile_status"];
          must_change_password: boolean;
          line_user_id: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name: string;
          role: Database["public"]["Enums"]["user_role"];
          department_id?: string | null;
          manager_id?: string | null;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["profile_status"];
          must_change_password?: boolean;
          line_user_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          display_name?: string;
          role?: Database["public"]["Enums"]["user_role"];
          department_id?: string | null;
          manager_id?: string | null;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["profile_status"];
          must_change_password?: boolean;
          line_user_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_manager_id_fkey";
            columns: ["manager_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      settings: {
        Row: {
          key: string;
          value: Json;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          key: string;
          value: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          key?: string;
          value?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      submissions: {
        Row: {
          id: string;
          template_key: string;
          form_version_id: string;
          user_id: string;
          target_user_id: string | null;
          target_submission_id: string | null;
          log_date: string | null;
          week_start: string | null;
          answers: Json;
          source: Database["public"]["Enums"]["submission_source"];
          submitted_at: string;
          updated_at: string;
          deleted_at: string | null;
          deleted_by: string | null;
          delete_reason: string | null;
        };
        Insert: {
          id?: string;
          template_key: string;
          form_version_id: string;
          user_id: string;
          target_user_id?: string | null;
          target_submission_id?: string | null;
          log_date?: string | null;
          week_start?: string | null;
          answers?: Json;
          source?: Database["public"]["Enums"]["submission_source"];
          submitted_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          delete_reason?: string | null;
        };
        Update: {
          id?: string;
          template_key?: string;
          form_version_id?: string;
          user_id?: string;
          target_user_id?: string | null;
          target_submission_id?: string | null;
          log_date?: string | null;
          week_start?: string | null;
          answers?: Json;
          source?: Database["public"]["Enums"]["submission_source"];
          submitted_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          delete_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "submissions_deleted_by_fkey";
            columns: ["deleted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submissions_form_version_id_fkey";
            columns: ["form_version_id"];
            isOneToOne: false;
            referencedRelation: "form_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submissions_target_submission_id_fkey";
            columns: ["target_submission_id"];
            isOneToOne: false;
            referencedRelation: "submissions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submissions_target_user_id_fkey";
            columns: ["target_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submissions_template_key_fkey";
            columns: ["template_key"];
            isOneToOne: false;
            referencedRelation: "form_templates";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "submissions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      set_updated_at: {
        Args: Record<PropertyKey, never>;
        Returns: unknown;
      };
    };
    Enums: {
      alert_status: "open" | "responded" | "closed";
      form_target_role: "newcomer" | "manager";
      form_version_status: "draft" | "published" | "archived";
      milestone_kind: "D30" | "D60" | "D90";
      milestone_outcome: "continue" | "watch" | "adjust" | "end";
      profile_status: "active" | "left" | "sample";
      submission_source: "app" | "import";
      user_role: "newcomer" | "manager" | "hr" | "ceo" | "admin";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      alert_status: ["open", "responded", "closed"],
      form_target_role: ["newcomer", "manager"],
      form_version_status: ["draft", "published", "archived"],
      milestone_kind: ["D30", "D60", "D90"],
      milestone_outcome: ["continue", "watch", "adjust", "end"],
      profile_status: ["active", "left", "sample"],
      submission_source: ["app", "import"],
      user_role: ["newcomer", "manager", "hr", "ceo", "admin"],
    },
  },
} as const;
