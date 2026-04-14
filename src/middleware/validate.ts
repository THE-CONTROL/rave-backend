// src/middleware/validate.ts
import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { ApiResponse } from "../types";

type ValidationTarget = "body" | "query" | "params";

export const validate =
  (schema: ZodSchema, target: ValidationTarget = "body") =>
    (req: Request, res: Response, next: NextFunction): void => {
      const result = schema.safeParse(req[target]);

      if (!result.success) {
        res.status(422).json({
          success: false,
          message: "Validation failed",
          data: (result.error as ZodError).flatten().fieldErrors,
        } satisfies ApiResponse);
        return;
      }

      // Replace the target with the parsed (coerced + stripped) data
      req[target] = result.data;
      next();
    };
