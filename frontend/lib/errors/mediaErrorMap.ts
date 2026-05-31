import type { ErrorModule, UserFacingError } from "./types";

function withModuleCategory(module: ErrorModule | undefined, fallback: "image_generation" | "image_edit" | "video_generation") {
  if (module === "image_edit") return "image_edit" as const;
  if (module === "video") return "video_generation" as const;
  return fallback;
}

export function mapMediaError(raw: string, module?: ErrorModule): Partial<UserFacingError> | null {
  const message = raw.trim();
  if (!message) return null;
  const category = withModuleCategory(module, module === "video" ? "video_generation" : module === "image_edit" ? "image_edit" : "image_generation");
  const isVideo = module === "video";
  const isEdit = module === "image_edit";

  if (/content policy|safety|unsafe|violat|内容.*(违规|安全|无法)|不符合生成规则/i.test(message)) {
    return {
      code: `${isVideo ? "video" : isEdit ? "image_edit" : "image"}_content_policy`,
      category: "content_policy",
      severity: "warning",
      title: "内容无法生成",
      message: isVideo ? "当前描述无法生成视频，请调整后重试。" : "当前描述可能不符合生成规则，请调整后重试。",
      action: "adjust_prompt",
      actionLabel: "调整描述",
    };
  }

  if (/invalid size|divisible by 16|尺寸.*(错误|无效|处理失败)/i.test(message)) {
    return {
      code: "image_edit_invalid_size",
      category: "image_edit",
      severity: "error",
      title: "图片尺寸处理失败",
      message: "图片尺寸处理失败，请重新上传图片后重试。",
      action: "upload_again",
      actionLabel: "重新上传",
    };
  }

  if (/mask|蒙版|涂抹区域无效|invalid.*mask/i.test(message)) {
    if (/请先涂抹|mask_required|必须提供.*mask/i.test(message)) {
      return {
        code: "image_edit_mask_required",
        category: "image_edit",
        severity: "warning",
        title: "需要涂抹区域",
        message: "请先涂抹需要处理的区域。",
        action: "none",
      };
    }
    return {
      code: "image_edit_invalid_mask",
      category: "image_edit",
      severity: "warning",
      title: "涂抹区域无效",
      message: "涂抹区域无效，请重新涂抹。",
      action: "upload_again",
      actionLabel: "重新涂抹",
    };
  }

  if (/物件识别失败|智能分割|grabcut|segment|recognition|没有返回物体轮廓|没有识别到/i.test(message)) {
    return {
      code: "image_edit_segment_failed",
      category: "image_edit",
      severity: "warning",
      title: "智能分割失败",
      message: "智能分割失败，请重新涂抹后重试。",
      action: "retry",
      actionLabel: "重新识别",
    };
  }

  if (/参考素材|reference|参考图|参考视频/i.test(message)) {
    return {
      code: isVideo ? "video_reference_invalid" : "image_reference_invalid",
      category: isVideo ? "video_generation" : "image_generation",
      severity: "warning",
      title: "参考素材不符合要求",
      message: isVideo ? "参考素材不符合要求，请重新上传。" : "参考图不符合要求，请重新上传。",
      action: "upload_again",
      actionLabel: "重新上传",
    };
  }

  if (/创建.*任务失败|创建记录失败|task.*create/i.test(message)) {
    return {
      code: isVideo ? "video_task_create_failed" : isEdit ? "image_edit_task_create_failed" : "image_task_create_failed",
      category,
      severity: "error",
      title: isVideo ? "视频任务创建失败" : isEdit ? "图片编辑任务创建失败" : "图片任务创建失败",
      message: isVideo ? "视频任务创建失败，请稍后重试。" : isEdit ? "图片编辑任务创建失败，请稍后重试。" : "图片任务创建失败，请稍后重试。",
      action: "retry",
      actionLabel: "重试",
    };
  }

  if (/保存源图失败|原图上传失败|upload.*source/i.test(message)) {
    return {
      code: "image_source_upload_failed",
      category: "image_edit",
      severity: "error",
      title: "原图上传失败",
      message: "原图上传失败，请重新选择图片。",
      action: "upload_again",
      actionLabel: "重新上传",
    };
  }

  if (/图片不存在|图片文件不存在|not found/i.test(message)) {
    return {
      code: "image_not_found",
      category,
      severity: "warning",
      title: "图片不存在",
      message: "图片不存在或已被删除。",
      action: "none",
    };
  }

  if (/视频文件不存在|video.*not found/i.test(message)) {
    return {
      code: "video_not_found",
      category: "video_generation",
      severity: "warning",
      title: "视频不存在",
      message: "视频不存在或已被删除。",
      action: "none",
    };
  }

  return null;
}
