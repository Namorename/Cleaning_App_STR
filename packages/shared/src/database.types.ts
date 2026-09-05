export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      hosts: {
        Row: {
          created_at: string
          id: string
          name: string
          parallel_start_allowed: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parallel_start_allowed?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parallel_start_allowed?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          host_id: string
          id: string
          is_active: boolean
          phone: string | null
          preferred_language: Database["public"]["Enums"]["app_language"] | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          host_id?: string
          id: string
          is_active?: boolean
          phone?: string | null
          preferred_language?:
            | Database["public"]["Enums"]["app_language"]
            | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          host_id?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          preferred_language?:
            | Database["public"]["Enums"]["app_language"]
            | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: string | null
          bathrooms: number | null
          bedrooms: number | null
          check_in_time: string | null
          check_out_time: string | null
          city: string | null
          cleaner_notes: string | null
          country_code: string | null
          created_at: string
          host_id: string
          id: number
          internal_notes: string | null
          is_active: boolean
          max_guests: number | null
          name: string
          parent_id: number | null
          synced_at: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          check_in_time?: string | null
          check_out_time?: string | null
          city?: string | null
          cleaner_notes?: string | null
          country_code?: string | null
          created_at?: string
          host_id?: string
          id: number
          internal_notes?: string | null
          is_active?: boolean
          max_guests?: number | null
          name: string
          parent_id?: number | null
          synced_at?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          check_in_time?: string | null
          check_out_time?: string | null
          city?: string | null
          cleaner_notes?: string | null
          country_code?: string | null
          created_at?: string
          host_id?: string
          id?: number
          internal_notes?: string | null
          is_active?: boolean
          max_guests?: number | null
          name?: string
          parent_id?: number | null
          synced_at?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_cleaners: {
        Row: {
          cleaner_id: string
          created_at: string
          host_id: string
          mode: Database["public"]["Enums"]["assignment_mode"]
          priority: number
          property_id: number
          updated_at: string
        }
        Insert: {
          cleaner_id: string
          created_at?: string
          host_id?: string
          mode?: Database["public"]["Enums"]["assignment_mode"]
          priority?: number
          property_id: number
          updated_at?: string
        }
        Update: {
          cleaner_id?: string
          created_at?: string
          host_id?: string
          mode?: Database["public"]["Enums"]["assignment_mode"]
          priority?: number
          property_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_cleaners_cleaner_id_fkey"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_cleaners_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_cleaners_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          arrival_date: string
          channel_id: number | null
          check_in_time: string | null
          check_out_time: string | null
          created_at: string
          departure_date: string
          guest_name: string | null
          guests_count: number | null
          host_id: string
          id: number
          is_block: boolean
          property_id: number
          status: string
          synced_at: string | null
          total_price: number | null
          updated_at: string
        }
        Insert: {
          arrival_date: string
          channel_id?: number | null
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          departure_date: string
          guest_name?: string | null
          guests_count?: number | null
          host_id?: string
          id: number
          is_block?: boolean
          property_id: number
          status: string
          synced_at?: string | null
          total_price?: number | null
          updated_at?: string
        }
        Update: {
          arrival_date?: string
          channel_id?: number | null
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          departure_date?: string
          guest_name?: string | null
          guests_count?: number | null
          host_id?: string
          id?: number
          is_block?: boolean
          property_id?: number
          status?: string
          synced_at?: string | null
          total_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      task_steps: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          config: Json
          created_at: string
          device_completed_at: string | null
          host_id: string
          id: string
          instructions: string | null
          max_photos: number | null
          max_video_sec: number | null
          min_photos: number | null
          payload: Json
          required: boolean
          skip_reason: string | null
          skipped_at: string | null
          sort_order: number
          started_at: string | null
          task_id: string
          template_step_id: string | null
          title: string | null
          type: Database["public"]["Enums"]["workflow_step_type"]
          updated_at: string
          waive_reason: string | null
          waived_at: string | null
          waived_by: string | null
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          config?: Json
          created_at?: string
          device_completed_at?: string | null
          host_id?: string
          id?: string
          instructions?: string | null
          max_photos?: number | null
          max_video_sec?: number | null
          min_photos?: number | null
          payload?: Json
          required: boolean
          skip_reason?: string | null
          skipped_at?: string | null
          sort_order: number
          started_at?: string | null
          task_id: string
          template_step_id?: string | null
          title?: string | null
          type: Database["public"]["Enums"]["workflow_step_type"]
          updated_at?: string
          waive_reason?: string | null
          waived_at?: string | null
          waived_by?: string | null
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          config?: Json
          created_at?: string
          device_completed_at?: string | null
          host_id?: string
          id?: string
          instructions?: string | null
          max_photos?: number | null
          max_video_sec?: number | null
          min_photos?: number | null
          payload?: Json
          required?: boolean
          skip_reason?: string | null
          skipped_at?: string | null
          sort_order?: number
          started_at?: string | null
          task_id?: string
          template_step_id?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["workflow_step_type"]
          updated_at?: string
          waive_reason?: string | null
          waived_at?: string | null
          waived_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_steps_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_steps_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_steps_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "expired_tasks_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_steps_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_steps_template_step_id_fkey"
            columns: ["template_step_id"]
            isOneToOne: false
            referencedRelation: "workflow_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_steps_waived_by_fkey"
            columns: ["waived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          due_at: string | null
          duration_override_min: number | null
          guests_count: number | null
          host_id: string
          id: string
          is_parallel: boolean
          is_short_measurement: boolean | null
          measured_minutes: number | null
          notes: string | null
          priority: number
          property_id: number
          reservation_id: number | null
          scheduled_date: string
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          time_from: string | null
          time_to: string | null
          type: Database["public"]["Enums"]["task_type"]
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          due_at?: string | null
          duration_override_min?: number | null
          guests_count?: number | null
          host_id?: string
          id?: string
          is_parallel?: boolean
          is_short_measurement?: boolean | null
          measured_minutes?: number | null
          notes?: string | null
          priority?: number
          property_id: number
          reservation_id?: number | null
          scheduled_date: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          time_from?: string | null
          time_to?: string | null
          type: Database["public"]["Enums"]["task_type"]
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          due_at?: string | null
          duration_override_min?: number | null
          guests_count?: number | null
          host_id?: string
          id?: string
          is_parallel?: boolean
          is_short_measurement?: boolean | null
          measured_minutes?: number | null
          notes?: string | null
          priority?: number
          property_id?: number
          reservation_id?: number | null
          scheduled_date?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          time_from?: string | null
          time_to?: string | null
          type?: Database["public"]["Enums"]["task_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_steps: {
        Row: {
          applies_when: Json | null
          config: Json
          created_at: string
          host_id: string
          id: string
          instructions: string | null
          max_photos: number | null
          max_video_sec: number | null
          min_photos: number | null
          required: boolean
          sort_order: number
          template_id: string
          title: string | null
          type: Database["public"]["Enums"]["workflow_step_type"]
          updated_at: string
        }
        Insert: {
          applies_when?: Json | null
          config?: Json
          created_at?: string
          host_id?: string
          id?: string
          instructions?: string | null
          max_photos?: number | null
          max_video_sec?: number | null
          min_photos?: number | null
          required?: boolean
          sort_order: number
          template_id: string
          title?: string | null
          type: Database["public"]["Enums"]["workflow_step_type"]
          updated_at?: string
        }
        Update: {
          applies_when?: Json | null
          config?: Json
          created_at?: string
          host_id?: string
          id?: string
          instructions?: string | null
          max_photos?: number | null
          max_video_sec?: number | null
          min_photos?: number | null
          required?: boolean
          sort_order?: number
          template_id?: string
          title?: string | null
          type?: Database["public"]["Enums"]["workflow_step_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_steps_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_steps_host_id_template_id_fkey"
            columns: ["host_id", "template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["host_id", "id"]
          },
          {
            foreignKeyName: "workflow_steps_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_templates: {
        Row: {
          created_at: string
          enforce_order: boolean
          host_id: string
          id: string
          is_active: boolean
          name: string
          property_id: number | null
          scope: Database["public"]["Enums"]["workflow_scope"]
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          enforce_order?: boolean
          host_id?: string
          id?: string
          is_active?: boolean
          name: string
          property_id?: number | null
          scope: Database["public"]["Enums"]["workflow_scope"]
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          enforce_order?: boolean
          host_id?: string
          id?: string
          is_active?: boolean
          name?: string
          property_id?: number | null
          scope?: Database["public"]["Enums"]["workflow_scope"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "workflow_templates_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_templates_host_id_property_id_fkey"
            columns: ["host_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["host_id", "id"]
          },
        ]
      }
    }
    Views: {
      expired_tasks_review: {
        Row: {
          assignee_id: string | null
          assignee_name: string | null
          due_at: string | null
          expired_at: string | null
          id: string | null
          priority: number | null
          property_id: number | null
          property_name: string | null
          reservation_id: number | null
          scheduled_date: string | null
          task_notes: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      claim_webhook_events: {
        Args: { batch_size?: number; max_attempts?: number }
        Returns: Json
      }
      cleans_property: {
        Args: { target_property_id: number }
        Returns: boolean
      }
      complete_task_step: {
        Args: {
          p_device_completed_at?: string
          p_payload?: Json
          p_step_id: string
        }
        Returns: {
          completed_at: string | null
          completed_by: string | null
          config: Json
          created_at: string
          device_completed_at: string | null
          host_id: string
          id: string
          instructions: string | null
          max_photos: number | null
          max_video_sec: number | null
          min_photos: number | null
          payload: Json
          required: boolean
          skip_reason: string | null
          skipped_at: string | null
          sort_order: number
          started_at: string | null
          task_id: string
          template_step_id: string | null
          title: string | null
          type: Database["public"]["Enums"]["workflow_step_type"]
          updated_at: string
          waive_reason: string | null
          waived_at: string | null
          waived_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "task_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_host_id: { Args: never; Returns: string }
      default_host_id: { Args: never; Returns: string }
      expire_stale_tasks: { Args: never; Returns: Json }
      generate_cleaning_tasks: {
        Args: { from_date: string; to_date: string }
        Returns: Json
      }
      invoke_edge_function: { Args: { function_name: string }; Returns: number }
      is_active_user: { Args: never; Returns: boolean }
      is_manager: { Args: never; Returns: boolean }
      mark_webhook_events: {
        Args: { error_text?: string; event_ids: number[]; new_status: string }
        Returns: number
      }
      open_task_step: {
        Args: { p_step_id: string }
        Returns: {
          completed_at: string | null
          completed_by: string | null
          config: Json
          created_at: string
          device_completed_at: string | null
          host_id: string
          id: string
          instructions: string | null
          max_photos: number | null
          max_video_sec: number | null
          min_photos: number | null
          payload: Json
          required: boolean
          skip_reason: string | null
          skipped_at: string | null
          sort_order: number
          started_at: string | null
          task_id: string
          template_step_id: string | null
          title: string | null
          type: Database["public"]["Enums"]["workflow_step_type"]
          updated_at: string
          waive_reason: string | null
          waived_at: string | null
          waived_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "task_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_webhook_event: {
        Args: { event_payload: Json; event_source?: string }
        Returns: number
      }
      reopen_task_step: {
        Args: { p_step_id: string }
        Returns: {
          completed_at: string | null
          completed_by: string | null
          config: Json
          created_at: string
          device_completed_at: string | null
          host_id: string
          id: string
          instructions: string | null
          max_photos: number | null
          max_video_sec: number | null
          min_photos: number | null
          payload: Json
          required: boolean
          skip_reason: string | null
          skipped_at: string | null
          sort_order: number
          started_at: string | null
          task_id: string
          template_step_id: string | null
          title: string | null
          type: Database["public"]["Enums"]["workflow_step_type"]
          updated_at: string
          waive_reason: string | null
          waived_at: string | null
          waived_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "task_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reservation_cleaning_window: {
        Args: { target_reservation_id: number }
        Returns: {
          guests_count: number
          same_day_turnover: boolean
          window_from: string
          window_to: string
        }[]
      }
      resolve_workflow_template: {
        Args: {
          p_property_id: number
          p_scope: Database["public"]["Enums"]["workflow_scope"]
        }
        Returns: string
      }
      save_workflow_template: {
        Args: { p_template: Json }
        Returns: {
          created_at: string
          enforce_order: boolean
          host_id: string
          id: string
          is_active: boolean
          name: string
          property_id: number | null
          scope: Database["public"]["Enums"]["workflow_scope"]
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "workflow_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      short_cleaning_threshold: { Args: never; Returns: string }
      skip_task_step: {
        Args: { p_reason?: string; p_step_id: string }
        Returns: {
          completed_at: string | null
          completed_by: string | null
          config: Json
          created_at: string
          device_completed_at: string | null
          host_id: string
          id: string
          instructions: string | null
          max_photos: number | null
          max_video_sec: number | null
          min_photos: number | null
          payload: Json
          required: boolean
          skip_reason: string | null
          skipped_at: string | null
          sort_order: number
          started_at: string | null
          task_id: string
          template_step_id: string | null
          title: string | null
          type: Database["public"]["Enums"]["workflow_step_type"]
          updated_at: string
          waive_reason: string | null
          waived_at: string | null
          waived_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "task_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sync_hostaway_listings: {
        Args: { property_rows: Json; raw_rows: Json }
        Returns: Json
      }
      sync_hostaway_reservations: {
        Args: { raw_rows: Json; reservation_rows: Json }
        Returns: Json
      }
      task_grace_days: { Args: never; Returns: number }
      task_horizon_days: { Args: never; Returns: number }
      task_is_beyond_horizon: {
        Args: { target_property_id: number; target_scheduled_date: string }
        Returns: boolean
      }
      task_is_stale: {
        Args: { target_property_id: number; target_scheduled_date: string }
        Returns: boolean
      }
      task_note_line_count: { Args: { p_text: string }; Returns: number }
      task_step_for_update: {
        Args: { p_require_assignee: boolean; p_step_id: string }
        Returns: {
          completed_at: string | null
          completed_by: string | null
          config: Json
          created_at: string
          device_completed_at: string | null
          host_id: string
          id: string
          instructions: string | null
          max_photos: number | null
          max_video_sec: number | null
          min_photos: number | null
          payload: Json
          required: boolean
          skip_reason: string | null
          skipped_at: string | null
          sort_order: number
          started_at: string | null
          task_id: string
          template_step_id: string | null
          title: string | null
          type: Database["public"]["Enums"]["workflow_step_type"]
          updated_at: string
          waive_reason: string | null
          waived_at: string | null
          waived_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "task_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      validate_task_step_payload: {
        Args: {
          p_instructions: string
          p_payload: Json
          p_type: Database["public"]["Enums"]["workflow_step_type"]
        }
        Returns: Json
      }
      waive_task_step: {
        Args: { p_reason: string; p_step_id: string }
        Returns: {
          completed_at: string | null
          completed_by: string | null
          config: Json
          created_at: string
          device_completed_at: string | null
          host_id: string
          id: string
          instructions: string | null
          max_photos: number | null
          max_video_sec: number | null
          min_photos: number | null
          payload: Json
          required: boolean
          skip_reason: string | null
          skipped_at: string | null
          sort_order: number
          started_at: string | null
          task_id: string
          template_step_id: string | null
          title: string | null
          type: Database["public"]["Enums"]["workflow_step_type"]
          updated_at: string
          waive_reason: string | null
          waived_at: string | null
          waived_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "task_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      workflow_scope_for: {
        Args: { p_type: Database["public"]["Enums"]["task_type"] }
        Returns: Database["public"]["Enums"]["workflow_scope"]
      }
      workflow_supported_step_types: {
        Args: never
        Returns: Database["public"]["Enums"]["workflow_step_type"][]
      }
    }
    Enums: {
      app_language: "en" | "ru" | "cs"
      app_role: "cleaner" | "tech" | "manager" | "admin"
      assignment_mode: "auto" | "claim"
      task_status:
        | "unassigned"
        | "assigned"
        | "accepted"
        | "in_progress"
        | "paused"
        | "blocked"
        | "done"
        | "cancelled"
        | "expired"
      task_type: "cleaning" | "maintenance" | "inspection" | "midstay"
      workflow_scope: "cleaning" | "midstay" | "problem" | "inspection"
      workflow_step_type:
        | "photos_before"
        | "checklist"
        | "inventory"
        | "special_requests"
        | "photos_after"
        | "video"
        | "task_note"
        | "cleaner_comment"
        | "confirmation"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_language: ["en", "ru", "cs"],
      app_role: ["cleaner", "tech", "manager", "admin"],
      assignment_mode: ["auto", "claim"],
      task_status: [
        "unassigned",
        "assigned",
        "accepted",
        "in_progress",
        "paused",
        "blocked",
        "done",
        "cancelled",
        "expired",
      ],
      task_type: ["cleaning", "maintenance", "inspection", "midstay"],
      workflow_scope: ["cleaning", "midstay", "problem", "inspection"],
      workflow_step_type: [
        "photos_before",
        "checklist",
        "inventory",
        "special_requests",
        "photos_after",
        "video",
        "task_note",
        "cleaner_comment",
        "confirmation",
      ],
    },
  },
} as const

