import { z } from 'zod';

export const messageSchema = z.object({
  responseCode: z.number().int(),
  message: z.string().min(1),
});

export const productSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  price: z.string().regex(/^Rs\.\s*\d/),
  brand: z.string().min(1),
  category: z.object({
    usertype: z.object({ usertype: z.string().min(1) }),
    category: z.string().min(1),
  }),
});

export const productsSchema = z.object({
  responseCode: z.number().int(),
  products: z.array(productSchema),
});

export const userDetailsSchema = z.object({
  responseCode: z.number().int(),
  user: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    email: z.email(),
    first_name: z.string(),
    last_name: z.string(),
    address1: z.string(),
    country: z.string(),
    state: z.string(),
    city: z.string(),
    zipcode: z.string(),
  }),
});

export type Product = z.infer<typeof productSchema>;
export type Message = z.infer<typeof messageSchema>;

export interface ApiResult<T> {
  readonly httpStatus: number;
  readonly body: T;
}
