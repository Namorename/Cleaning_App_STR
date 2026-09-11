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
      checklist_items: {
        Row: {
          created_at: string
          host_id: string
          id: string
          is_optional: boolean
          module_id: string
          sort_order: number
          title: string
          title_i18n: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          host_id?: string
          id?: string
          is_optional?: boolean
          module_id: string
          sort_order: number
          title: string
          title_i18n?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          host_id?: string
          id?: string
          is_optional?: boolean
          module_id?: string
          sort_order?: number
          title?: string
          title_i18n?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_items_host_id_module_id_fkey"
            columns: ["host_id", "module_id"]
            isOneToOne: false
            referencedRelation: "checklist_modules"
            referencedColumns: ["host_id", "id"]
          },
          {
            foreignKeyName: "checklist_items_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "checklist_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_modules: {
        Row: {
          created_at: string
          host_id: string
          id: string
          property_id: number
          sort_order: number
          title: string
          title_i18n: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          host_id?: string
          id?: string
          property_id: number
          sort_order: number
          title: string
          title_i18n?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          host_id?: string
          id?: string
          property_id?: number
          sort_order?: number
          title?: string
          title_i18n?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_modules_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_modules_host_id_property_id_fkey"
            columns: ["host_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["host_id", "id"]
          },
        ]
      }
      hosts: {
        Row: {
          created_at: string
          default_language: Database["public"]["Enums"]["app_language"]
          gallery_allowed: boolean
          id: string
          name: string
          parallel_start_allowed: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_language?: Database["public"]["Enums"]["app_language"]
          gallery_allowed?: boolean
          id?: string
          name: string
          parallel_start_allowed?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_language?: Database["public"]["Enums"]["app_language"]
          gallery_allowed?: boolean
          id?: string
          name?: string
          parallel_start_allowed?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      problems: {
        Row: {
          archived_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          description: string | null
          host_id: string
          id: string
          priority: Database["public"]["Enums"]["problem_priority"]
          property_id: number | null
          reported_by: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["problem_status"]
          task_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          description?: string | null
          host_id?: string
          id: string
          priority?: Database["public"]["Enums"]["problem_priority"]
          property_id?: number | null
          reported_by: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["problem_status"]
          task_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          description?: string | null
          host_id?: string
          id?: string
          priority?: Database["public"]["Enums"]["problem_priority"]
          property_id?: number | null
          reported_by?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["problem_status"]
          task_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "problems_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problems_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problems_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problems_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "expired_tasks_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problems_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
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
          email?: string | null
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
          email?: string | null
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
          hostaway_unit_id: number | null
          id: number
          internal_notes: string | null
          max_guests: number | null
          name: string
          parent_id: number | null
          status: Database["public"]["Enums"]["property_status"]
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
          hostaway_unit_id?: number | null
          id: number
          internal_notes?: string | null
          max_guests?: number | null
          name: string
          parent_id?: number | null
          status?: Database["public"]["Enums"]["property_status"]
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
          hostaway_unit_id?: number | null
          id?: number
          internal_notes?: string | null
          max_guests?: number | null
          name?: string
          parent_id?: number | null
          status?: Database["public"]["Enums"]["property_status"]
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
      reservation_units: {
        Row: {
          created_at: string
          host_id: string
          property_id: number
          reservation_id: number
        }
        Insert: {
          created_at?: string
          host_id?: string
          property_id: number
          reservation_id: number
        }
        Update: {
          created_at?: string
          host_id?: string
          property_id?: number
          reservation_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "reservation_units_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_units_host_id_property_id_fkey"
            columns: ["host_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["host_id", "id"]
          },
          {
            foreignKeyName: "reservation_units_host_id_reservation_id_fkey"
            columns: ["host_id", "reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["host_id", "id"]
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
      supply_catalog_items: {
        Row: {
          archived_at: string | null
          created_at: string
          host_id: string
          id: string
          name: string
          name_i18n: Json
          sort_order: number
          unit: Database["public"]["Enums"]["supply_unit"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          host_id?: string
          id?: string
          name: string
          name_i18n?: Json
          sort_order?: number
          unit?: Database["public"]["Enums"]["supply_unit"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          host_id?: string
          id?: string
          name?: string
          name_i18n?: Json
          sort_order?: number
          unit?: Database["public"]["Enums"]["supply_unit"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supply_catalog_items_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_request_items: {
        Row: {
          catalog_item_id: string | null
          comment: string | null
          host_id: string
          id: string
          name: string
          quantity: number
          request_id: string
          sort_order: number
          unit: Database["public"]["Enums"]["supply_unit"]
        }
        Insert: {
          catalog_item_id?: string | null
          comment?: string | null
          host_id: string
          id?: string
          name: string
          quantity: number
          request_id: string
          sort_order: number
          unit?: Database["public"]["Enums"]["supply_unit"]
        }
        Update: {
          catalog_item_id?: string | null
          comment?: string | null
          host_id?: string
          id?: string
          name?: string
          quantity?: number
          request_id?: string
          sort_order?: number
          unit?: Database["public"]["Enums"]["supply_unit"]
        }
        Relationships: [
          {
            foreignKeyName: "supply_request_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "supply_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_request_items_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "supply_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_requests: {
        Row: {
          created_at: string
          fulfilled_at: string | null
          host_id: string
          id: string
          needed_by: string | null
          note: string | null
          priority: Database["public"]["Enums"]["supply_priority"]
          property_id: number | null
          reject_reason: string | null
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["supply_request_status"]
          task_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          fulfilled_at?: string | null
          host_id?: string
          id: string
          needed_by?: string | null
          note?: string | null
          priority?: Database["public"]["Enums"]["supply_priority"]
          property_id?: number | null
          reject_reason?: string | null
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["supply_request_status"]
          task_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          fulfilled_at?: string | null
          host_id?: string
          id?: string
          needed_by?: string | null
          note?: string | null
          priority?: Database["public"]["Enums"]["supply_priority"]
          property_id?: number | null
          reject_reason?: string | null
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["supply_request_status"]
          task_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supply_requests_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_requests_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "expired_tasks_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_media: {
        Row: {
          byte_size: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          device_taken_at: string | null
          duration_sec: number | null
          height: number | null
          host_id: string
          id: string
          kind: Database["public"]["Enums"]["media_kind"]
          mime_type: string
          problem_id: string | null
          purged_at: string | null
          step_id: string | null
          storage_path: string
          task_id: string | null
          uploaded_at: string | null
          width: number | null
        }
        Insert: {
          byte_size: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          device_taken_at?: string | null
          duration_sec?: number | null
          height?: number | null
          host_id: string
          id?: string
          kind: Database["public"]["Enums"]["media_kind"]
          mime_type: string
          problem_id?: string | null
          purged_at?: string | null
          step_id?: string | null
          storage_path: string
          task_id?: string | null
          uploaded_at?: string | null
          width?: number | null
        }
        Update: {
          byte_size?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          device_taken_at?: string | null
          duration_sec?: number | null
          height?: number | null
          host_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["media_kind"]
          mime_type?: string
          problem_id?: string | null
          purged_at?: string | null
          step_id?: string | null
          storage_path?: string
          task_id?: string | null
          uploaded_at?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "task_media_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_media_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_media_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_media_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "task_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_media_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "expired_tasks_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_media_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
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
          instructions_i18n: Json
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
          title_i18n: Json
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
          instructions_i18n?: Json
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
          title_i18n?: Json
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
          instructions_i18n?: Json
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
          title_i18n?: Json
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
          created_by: string | null
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
          problem_id: string | null
          property_id: number
          reservation_id: number | null
          scheduled_date: string
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          time_from: string | null
          time_to: string | null
          title: string | null
          title_i18n: Json
          type: Database["public"]["Enums"]["task_type"]
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
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
          problem_id?: string | null
          property_id: number
          reservation_id?: number | null
          scheduled_date: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          time_from?: string | null
          time_to?: string | null
          title?: string | null
          title_i18n?: Json
          type: Database["public"]["Enums"]["task_type"]
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
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
          problem_id?: string | null
          property_id?: number
          reservation_id?: number | null
          scheduled_date?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          time_from?: string | null
          time_to?: string | null
          title?: string | null
          title_i18n?: Json
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
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
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
            foreignKeyName: "tasks_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
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
          instructions_i18n: Json
          max_photos: number | null
          max_video_sec: number | null
          min_photos: number | null
          required: boolean
          sort_order: number
          template_id: string
          title: string | null
          title_i18n: Json
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
          instructions_i18n?: Json
          max_photos?: number | null
          max_video_sec?: number | null
          min_photos?: number | null
          required?: boolean
          sort_order: number
          template_id: string
          title?: string | null
          title_i18n?: Json
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
          instructions_i18n?: Json
          max_photos?: number | null
          max_video_sec?: number | null
          min_photos?: number | null
          required?: boolean
          sort_order?: number
          template_id?: string
          title?: string | null
          title_i18n?: Json
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
      add_problem_media: {
        Args: {
          p_byte_size: number
          p_device_taken_at?: string
          p_height?: number
          p_id: string
          p_mime_type: string
          p_problem_id: string
          p_width?: number
        }
        Returns: {
          byte_size: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          device_taken_at: string | null
          duration_sec: number | null
          height: number | null
          host_id: string
          id: string
          kind: Database["public"]["Enums"]["media_kind"]
          mime_type: string
          problem_id: string | null
          purged_at: string | null
          step_id: string | null
          storage_path: string
          task_id: string | null
          uploaded_at: string | null
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "task_media"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_task_media: {
        Args: {
          p_byte_size: number
          p_device_taken_at?: string
          p_duration_sec?: number
          p_height?: number
          p_id: string
          p_kind: Database["public"]["Enums"]["media_kind"]
          p_mime_type: string
          p_step_id: string
          p_width?: number
        }
        Returns: {
          byte_size: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          device_taken_at: string | null
          duration_sec: number | null
          height: number | null
          host_id: string
          id: string
          kind: Database["public"]["Enums"]["media_kind"]
          mime_type: string
          problem_id: string | null
          purged_at: string | null
          step_id: string | null
          storage_path: string
          task_id: string | null
          uploaded_at: string | null
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "task_media"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_problem: {
        Args: { p_id: string }
        Returns: {
          archived_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          description: string | null
          host_id: string
          id: string
          priority: Database["public"]["Enums"]["problem_priority"]
          property_id: number | null
          reported_by: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["problem_status"]
          task_id: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "problems"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_supply_catalog_item: {
        Args: { p_archived?: boolean; p_id: string }
        Returns: {
          archived_at: string | null
          created_at: string
          host_id: string
          id: string
          name: string
          name_i18n: Json
          sort_order: number
          unit: Database["public"]["Enums"]["supply_unit"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supply_catalog_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_problem: {
        Args: {
          p_assignee_id: string
          p_id: string
          p_scheduled_date?: string
          p_time_from?: string
          p_time_to?: string
        }
        Returns: {
          archived_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          description: string | null
          host_id: string
          id: string
          priority: Database["public"]["Enums"]["problem_priority"]
          property_id: number | null
          reported_by: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["problem_status"]
          task_id: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "problems"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      can_read_task_media: { Args: { p_path: string }; Returns: boolean }
      can_upload_task_media: { Args: { p_path: string }; Returns: boolean }
      cancel_problem: {
        Args: { p_id: string; p_reason?: string }
        Returns: {
          archived_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          description: string | null
          host_id: string
          id: string
          priority: Database["public"]["Enums"]["problem_priority"]
          property_id: number | null
          reported_by: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["problem_status"]
          task_id: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "problems"
          isOneToOne: true
          isSetofReturn: false
        }
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
          instructions_i18n: Json
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
          title_i18n: Json
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
      confirm_task_media: {
        Args: { p_id: string }
        Returns: {
          byte_size: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          device_taken_at: string | null
          duration_sec: number | null
          height: number | null
          host_id: string
          id: string
          kind: Database["public"]["Enums"]["media_kind"]
          mime_type: string
          problem_id: string | null
          purged_at: string | null
          step_id: string | null
          storage_path: string
          task_id: string | null
          uploaded_at: string | null
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "task_media"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      copy_property_checklist: {
        Args: { p_source_property_id: number; p_target_property_id: number }
        Returns: Json
      }
      current_host_id: { Args: never; Returns: string }
      default_host_id: { Args: never; Returns: string }
      delete_supply_request: { Args: { p_id: string }; Returns: boolean }
      expire_stale_tasks: { Args: never; Returns: Json }
      generate_cleaning_tasks: {
        Args: { from_date: string; to_date: string }
        Returns: Json
      }
      invoke_edge_function: { Args: { function_name: string }; Returns: number }
      is_active_user: { Args: never; Returns: boolean }
      is_localized_text: { Args: { p_value: Json }; Returns: boolean }
      is_manager: { Args: never; Returns: boolean }
      mark_task_media_purged: { Args: { p_ids: string[] }; Returns: number }
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
          instructions_i18n: Json
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
          title_i18n: Json
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
      problem_description_max_length: { Args: never; Returns: number }
      problem_for_manager: {
        Args: { p_id: string }
        Returns: {
          archived_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          description: string | null
          host_id: string
          id: string
          priority: Database["public"]["Enums"]["problem_priority"]
          property_id: number | null
          reported_by: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["problem_status"]
          task_id: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "problems"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      problem_max_photos: { Args: never; Returns: number }
      problem_title_max_length: { Args: never; Returns: number }
      property_checklist_snapshot: {
        Args: { p_property_id: number }
        Returns: Json
      }
      property_id_for_unit: { Args: { p_unit_id: number }; Returns: number }
      property_open_cleanings: {
        Args: { p_property_id: number }
        Returns: number
      }
      record_webhook_event: {
        Args: { event_payload: Json; event_source?: string }
        Returns: number
      }
      remove_task_media: {
        Args: { p_id: string }
        Returns: {
          byte_size: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          device_taken_at: string | null
          duration_sec: number | null
          height: number | null
          host_id: string
          id: string
          kind: Database["public"]["Enums"]["media_kind"]
          mime_type: string
          problem_id: string | null
          purged_at: string | null
          step_id: string | null
          storage_path: string
          task_id: string | null
          uploaded_at: string | null
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "task_media"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reopen_problem: {
        Args: { p_id: string }
        Returns: {
          archived_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          description: string | null
          host_id: string
          id: string
          priority: Database["public"]["Enums"]["problem_priority"]
          property_id: number | null
          reported_by: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["problem_status"]
          task_id: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "problems"
          isOneToOne: true
          isSetofReturn: false
        }
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
          instructions_i18n: Json
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
          title_i18n: Json
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
      report_problem: {
        Args: {
          p_description?: string
          p_id: string
          p_priority?: Database["public"]["Enums"]["problem_priority"]
          p_property_id?: number
          p_task_id?: string
          p_title: string
        }
        Returns: {
          archived_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          description: string | null
          host_id: string
          id: string
          priority: Database["public"]["Enums"]["problem_priority"]
          property_id: number | null
          reported_by: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["problem_status"]
          task_id: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "problems"
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
      resolve_checklist_property: {
        Args: { p_property_id: number }
        Returns: number
      }
      resolve_problem: {
        Args: { p_id: string }
        Returns: {
          archived_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          description: string | null
          host_id: string
          id: string
          priority: Database["public"]["Enums"]["problem_priority"]
          property_id: number | null
          reported_by: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["problem_status"]
          task_id: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "problems"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_report_property: {
        Args: { p_property_id: number; p_task_id: string }
        Returns: number
      }
      resolve_workflow_template: {
        Args: {
          p_property_id: number
          p_scope: Database["public"]["Enums"]["workflow_scope"]
        }
        Returns: string
      }
      review_supply_request: {
        Args: {
          p_id: string
          p_reject_reason?: string
          p_status: Database["public"]["Enums"]["supply_request_status"]
        }
        Returns: {
          created_at: string
          fulfilled_at: string | null
          host_id: string
          id: string
          needed_by: string | null
          note: string | null
          priority: Database["public"]["Enums"]["supply_priority"]
          property_id: number | null
          reject_reason: string | null
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["supply_request_status"]
          task_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supply_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_property_checklist: {
        Args: { p_modules: Json; p_property_id: number }
        Returns: Json
      }
      save_property_cleaner: {
        Args: {
          p_cleaner_id: string
          p_mode?: Database["public"]["Enums"]["assignment_mode"]
          p_priority?: number
          p_property_id: number
        }
        Returns: {
          cleaner_id: string
          created_at: string
          host_id: string
          mode: Database["public"]["Enums"]["assignment_mode"]
          priority: number
          property_id: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "property_cleaners"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_supply_catalog_item: {
        Args: {
          p_id: string
          p_name: string
          p_name_i18n?: Json
          p_sort_order?: number
          p_unit?: Database["public"]["Enums"]["supply_unit"]
        }
        Returns: {
          archived_at: string | null
          created_at: string
          host_id: string
          id: string
          name: string
          name_i18n: Json
          sort_order: number
          unit: Database["public"]["Enums"]["supply_unit"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supply_catalog_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_supply_request: {
        Args: {
          p_id: string
          p_items: Json
          p_needed_by?: string
          p_note?: string
          p_priority?: Database["public"]["Enums"]["supply_priority"]
          p_property_id?: number
          p_task_id?: string
        }
        Returns: {
          created_at: string
          fulfilled_at: string | null
          host_id: string
          id: string
          needed_by: string | null
          note: string | null
          priority: Database["public"]["Enums"]["supply_priority"]
          property_id: number | null
          reject_reason: string | null
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["supply_request_status"]
          task_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supply_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_task: {
        Args: {
          p_allow_duplicate?: boolean
          p_assignee_id?: string
          p_id: string
          p_notes?: string
          p_priority?: number
          p_property_id: number
          p_scheduled_date: string
          p_time_from?: string
          p_time_to?: string
          p_title?: string
          p_title_i18n?: Json
          p_type: Database["public"]["Enums"]["task_type"]
        }
        Returns: {
          assignee_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
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
          problem_id: string | null
          property_id: number
          reservation_id: number | null
          scheduled_date: string
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          time_from: string | null
          time_to: string | null
          title: string | null
          title_i18n: Json
          type: Database["public"]["Enums"]["task_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
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
      set_property_status: {
        Args: {
          p_cancel_tasks?: boolean
          p_property_id: number
          p_status: Database["public"]["Enums"]["property_status"]
        }
        Returns: {
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
          hostaway_unit_id: number | null
          id: number
          internal_notes: string | null
          max_guests: number | null
          name: string
          parent_id: number | null
          status: Database["public"]["Enums"]["property_status"]
          synced_at: string | null
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "properties"
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
          instructions_i18n: Json
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
          title_i18n: Json
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
      supply_item_name_max_length: { Args: never; Returns: number }
      supply_note_max_length: { Args: never; Returns: number }
      sync_hostaway_listings: {
        Args: { property_rows: Json; raw_rows: Json; unit_rows?: Json }
        Returns: Json
      }
      sync_hostaway_reservations: {
        Args: { raw_rows: Json; reservation_rows: Json; unit_rows?: Json }
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
      task_media_extension: { Args: { p_mime_type: string }; Returns: string }
      task_media_max_bytes: {
        Args: { p_kind: Database["public"]["Enums"]["media_kind"] }
        Returns: number
      }
      task_media_max_photos: { Args: never; Returns: number }
      task_media_max_video_sec: { Args: never; Returns: number }
      task_media_retention_days: { Args: never; Returns: number }
      task_media_to_purge: {
        Args: { p_limit?: number }
        Returns: {
          byte_size: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          device_taken_at: string | null
          duration_sec: number | null
          height: number | null
          host_id: string
          id: string
          kind: Database["public"]["Enums"]["media_kind"]
          mime_type: string
          problem_id: string | null
          purged_at: string | null
          step_id: string | null
          storage_path: string
          task_id: string | null
          uploaded_at: string | null
          width: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "task_media"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      task_note_line_count: { Args: { p_text: string }; Returns: number }
      task_start_not_before: {
        Args: {
          target_property_id: number
          target_scheduled_date: string
          target_time_from: string
        }
        Returns: string
      }
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
          instructions_i18n: Json
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
          title_i18n: Json
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
      task_title_max_length: { Args: never; Returns: number }
      unarchive_problem: {
        Args: { p_id: string }
        Returns: {
          archived_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          description: string | null
          host_id: string
          id: string
          priority: Database["public"]["Enums"]["problem_priority"]
          property_id: number | null
          reported_by: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["problem_status"]
          task_id: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "problems"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_host_settings: {
        Args: {
          p_gallery_allowed?: boolean
          p_parallel_start_allowed?: boolean
        }
        Returns: {
          created_at: string
          default_language: Database["public"]["Enums"]["app_language"]
          gallery_allowed: boolean
          id: string
          name: string
          parallel_start_allowed: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "hosts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_problem: {
        Args: {
          p_description?: string
          p_id: string
          p_priority?: Database["public"]["Enums"]["problem_priority"]
          p_title: string
        }
        Returns: {
          archived_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          description: string | null
          host_id: string
          id: string
          priority: Database["public"]["Enums"]["problem_priority"]
          property_id: number | null
          reported_by: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["problem_status"]
          task_id: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "problems"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      validate_problem_text: {
        Args: { p_description: string; p_title: string }
        Returns: undefined
      }
      validate_task_step_payload: {
        Args: {
          p_config: Json
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
          instructions_i18n: Json
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
          title_i18n: Json
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
      media_kind: "photo" | "video"
      problem_priority: "low" | "normal" | "high"
      problem_status:
        | "open"
        | "assigned"
        | "in_progress"
        | "resolved"
        | "cancelled"
      property_status: "active" | "maintenance" | "archived"
      supply_priority: "normal" | "urgent"
      supply_request_status:
        | "new"
        | "accepted"
        | "ordered"
        | "fulfilled"
        | "rejected"
      supply_unit: "pcs" | "pack" | "l" | "kg" | "roll"
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
      media_kind: ["photo", "video"],
      problem_priority: ["low", "normal", "high"],
      problem_status: [
        "open",
        "assigned",
        "in_progress",
        "resolved",
        "cancelled",
      ],
      property_status: ["active", "maintenance", "archived"],
      supply_priority: ["normal", "urgent"],
      supply_request_status: [
        "new",
        "accepted",
        "ordered",
        "fulfilled",
        "rejected",
      ],
      supply_unit: ["pcs", "pack", "l", "kg", "roll"],
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

