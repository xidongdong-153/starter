import { expect, it } from 'vitest'

import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_MAX_SIZE_BYTES,
  attachmentRejectionMessage,
  selectUploadableImages,
} from '@web/lib/ai/attachment-input'

function imageFile(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type })
}

it('白名单内的四种 MIME 都通过预校验', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
    const { accepted, rejections } = selectUploadableImages([imageFile(`a.${type}`, type)], 0)
    expect(accepted).toHaveLength(1)
    expect(rejections).toHaveLength(0)
  }
})

it('白名单外的 MIME 被拒绝且不上传', () => {
  const { accepted, rejections } = selectUploadableImages(
    [imageFile('a.svg', 'image/svg+xml'), imageFile('b.txt', '')],
    0,
  )
  expect(accepted).toHaveLength(0)
  expect(rejections).toEqual([
    { name: 'a.svg', rejection: 'type_not_allowed' },
    { name: 'b.txt', rejection: 'type_not_allowed' },
  ])
})

it('超过 5MB 的图片被拒绝', () => {
  const oversize = imageFile('big.png', 'image/png', ATTACHMENT_MAX_SIZE_BYTES + 1)
  const exact = imageFile('ok.png', 'image/png', ATTACHMENT_MAX_SIZE_BYTES)
  const { accepted, rejections } = selectUploadableImages([oversize, exact], 0)
  expect(accepted.map((file) => file.name)).toEqual(['ok.png'])
  expect(rejections).toEqual([{ name: 'big.png', rejection: 'too_large' }])
})

it('待发送区满 4 张后继续追加会被拒绝', () => {
  const { accepted, rejections } = selectUploadableImages([imageFile('fifth.png', 'image/png')], 4)
  expect(accepted).toHaveLength(0)
  expect(rejections).toEqual([{ name: 'fifth.png', rejection: 'count_exceeded' }])
})

it('一次传入多张时按顺序消费剩余配额', () => {
  const files = [1, 2, 3].map((index) => imageFile(`pic-${index}.png`, 'image/png'))
  const { accepted, rejections } = selectUploadableImages(files, 2)
  expect(accepted.map((file) => file.name)).toEqual(['pic-1.png', 'pic-2.png'])
  expect(rejections).toEqual([{ name: 'pic-3.png', rejection: 'count_exceeded' }])
})

it('混合批次里被拒文件不影响其他文件通过', () => {
  const files = [
    imageFile('bad.pdf', 'application/pdf'),
    imageFile('good.png', 'image/png'),
    imageFile('big.jpg', 'image/jpeg', ATTACHMENT_MAX_SIZE_BYTES + 1),
  ]
  const { accepted, rejections } = selectUploadableImages(files, 0)
  expect(accepted.map((file) => file.name)).toEqual(['good.png'])
  expect(rejections).toEqual([
    { name: 'bad.pdf', rejection: 'type_not_allowed' },
    { name: 'big.jpg', rejection: 'too_large' },
  ])
})

it('拒绝提示文案和 accept 值与常量一致', () => {
  expect(attachmentRejectionMessage('type_not_allowed')).toBe('仅支持 JPEG、PNG、WebP、GIF 格式的图片。')
  expect(attachmentRejectionMessage('too_large')).toBe('单张图片不能超过 5MB。')
  expect(attachmentRejectionMessage('count_exceeded')).toBe(`一次最多携带 ${ATTACHMENT_MAX_COUNT} 张图片。`)
  expect(ATTACHMENT_MAX_COUNT).toBe(4)
  expect(ATTACHMENT_ACCEPT).toBe('image/jpeg,image/png,image/webp,image/gif')
})
