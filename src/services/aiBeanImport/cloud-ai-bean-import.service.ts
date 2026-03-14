import { inject, Injectable } from '@angular/core';

import { Platform } from '@ionic/angular/standalone';

import {
  Camera,
  CameraDirection,
  CameraResultType,
  CameraSource,
} from '@capacitor/camera';
import { TranslateService } from '@ngx-translate/core';
import { CapacitorPluginMlKitTextRecognition } from '@pantrist/capacitor-plugin-ml-kit-text-recognition';

import { Bean } from '../../classes/bean/bean';
import { CLOUD_AI_PROVIDER_ENUM } from '../../enums/settings/cloudAiProvider';
import { UIAlert } from '../uiAlert';
import { UIFileHelper } from '../uiFileHelper';
import { UIImage } from '../uiImage';
import { UILog } from '../uiLog';
import { UISettingsStorage } from '../uiSettingsStorage';
import { AIImportStep, createAIBeanImportError } from './ai-bean-import-error';
import { AIReadinessResult } from './ai-bean-import.service';
import { CloudFieldExtractionService } from './cloud-field-extraction.service';
import {
  OcrMetadataService,
  TextDetectionResult,
} from './ocr-metadata.service';

@Injectable({
  providedIn: 'root',
})
export class CloudAIBeanImportService {
  private readonly uiImage = inject(UIImage);
  private readonly uiAlert = inject(UIAlert);
  private readonly translate = inject(TranslateService);
  private readonly platform = inject(Platform);
  private readonly uiLog = inject(UILog);
  private readonly uiFileHelper = inject(UIFileHelper);
  private readonly uiSettingsStorage = inject(UISettingsStorage);
  private readonly ocrMetadata = inject(OcrMetadataService);
  private readonly cloudFieldExtraction = inject(CloudFieldExtractionService);

  /**
   * Check if cloud AI is configured and ready to use.
   */
  public checkReadiness(): AIReadinessResult {
    if (!this.platform.is('capacitor')) {
      return {
        ready: false,
        message: this.translate.instant('AI_IMPORT_NOT_AVAILABLE_BROWSER'),
      };
    }

    const settings = this.uiSettingsStorage.getSettings();
    if (
      settings.cloud_ai_provider === CLOUD_AI_PROVIDER_ENUM.APPLE_INTELLIGENCE
    ) {
      return {
        ready: false,
        message: 'Apple Intelligence selected — use on-device path',
      };
    }
    if (!settings.cloud_ai_api_key || !settings.cloud_ai_model) {
      return {
        ready: false,
        message: this.translate.instant('CLOUD_AI_NOT_CONFIGURED'),
      };
    }
    return { ready: true };
  }

  /**
   * Capture a photo and extract bean data using OCR + Cloud LLM
   */
  public async captureAndExtractBeanData(): Promise<Bean | null> {
    let currentStep: AIImportStep = 'init';
    try {
      // Step 1: Capture image
      currentStep = 'camera_permission';
      await this.uiAlert.showLoadingSpinner('AI_IMPORT_STEP_CAPTURING', true);

      const hasPermission = await this.uiImage.checkCameraPermission();
      if (!hasPermission) {
        await this.uiAlert.hideLoadingSpinner();
        return null;
      }

      currentStep = 'take_photo';
      const imageData = await Camera.getPhoto({
        correctOrientation: true,
        direction: CameraDirection.Rear,
        quality: 90,
        resultType: CameraResultType.Base64,
        saveToGallery: false,
        source: CameraSource.Camera,
      });

      if (!imageData?.base64String) {
        await this.uiAlert.hideLoadingSpinner();
        return null;
      }
      this.uiLog.log(
        'Cloud AI: Photo captured, base64 length: ' +
          imageData.base64String.length,
      );

      // Step 2: Run OCR via ML Kit
      currentStep = 'ocr';
      this.uiAlert.setLoadingSpinnerMessage(
        this.translate.instant('AI_IMPORT_STEP_EXTRACTING'),
      );

      const ocrResult = (await CapacitorPluginMlKitTextRecognition.detectText({
        base64Image: imageData.base64String,
      })) as TextDetectionResult;
      const rawText = ocrResult.text;
      this.uiLog.log(
        'Cloud AI: OCR result: ' + JSON.stringify(ocrResult).substring(0, 500),
      );

      if (!rawText || rawText.trim() === '') {
        await this.uiAlert.hideLoadingSpinner();
        await this.uiAlert.showMessage(
          'AI_IMPORT_NO_TEXT_FOUND',
          'AI_IMPORT_NOT_AVAILABLE',
          undefined,
          true,
        );
        return null;
      }

      this.uiLog.log('Cloud AI: OCR extracted text: ' + rawText);

      // Step 3: Enrich with layout metadata and extract via cloud LLM
      currentStep = 'cloud_api';
      const bean = await this.processOcrAndExtractBean([ocrResult]);

      await this.uiAlert.hideLoadingSpinner();

      return bean;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Unknown error';
      this.uiLog.error(
        `Cloud AI Bean Import error at step [${currentStep}]: ${errorMessage}`,
      );
      this.uiLog.error('Full error: ' + JSON.stringify(error));
      await this.uiAlert.hideLoadingSpinner();

      throw createAIBeanImportError(
        `[${currentStep}] ${errorMessage}`,
        currentStep,
        error,
      );
    }
  }

  /**
   * Extract bean data from multiple photos using OCR + Cloud LLM.
   *
   * @param photoPaths Array of file paths to process
   * @param attachPhotos Whether to keep photos for attachment to the bean
   * @returns Bean with optional attachment paths, or null if extraction failed
   */
  public async extractBeanDataFromImages(
    photoPaths: string[],
    attachPhotos: boolean,
  ): Promise<{ bean: Bean; attachmentPaths?: string[] } | null> {
    let currentStep: AIImportStep = 'init';
    try {
      // Step 1: Run OCR on all photos
      currentStep = 'ocr';
      const ocrResults = await this.runOcrOnPhotos(photoPaths);

      // Check if we got any text at all
      if (ocrResults.length === 0) {
        await this.uiAlert.hideLoadingSpinner();
        await this.uiAlert.showMessage(
          'AI_IMPORT_NO_TEXT_FOUND',
          'AI_IMPORT_NOT_AVAILABLE',
          undefined,
          true,
        );

        if (!attachPhotos) {
          await this.cleanupPhotos(photoPaths);
        }
        return null;
      }

      // Step 2: Enrich with layout metadata and extract via cloud LLM
      currentStep = 'cloud_api';
      const bean = await this.processOcrAndExtractBean(ocrResults);

      // Step 3: Handle photo attachments
      if (!attachPhotos) {
        await this.cleanupPhotos(photoPaths);
        return { bean };
      }

      return { bean, attachmentPaths: photoPaths };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Unknown error';
      this.uiLog.error(
        `Cloud AI Multi-Photo Import error at step [${currentStep}]: ${errorMessage}`,
      );
      this.uiLog.error('Full error: ' + JSON.stringify(error));

      throw createAIBeanImportError(
        `[${currentStep}] ${errorMessage}`,
        currentStep,
        error,
      );
    }
  }

  /**
   * Shared pipeline for OCR post-processing and cloud field extraction.
   * Enriches OCR results with layout metadata, then sends to cloud LLM.
   */
  private async processOcrAndExtractBean(
    ocrResults: TextDetectionResult[],
  ): Promise<Bean> {
    // Step 1: Enrich with layout metadata
    const enrichedText =
      ocrResults.length === 1
        ? this.ocrMetadata.enrichWithLayout(ocrResults[0]).enrichedText
        : this.ocrMetadata.enrichMultiplePhotos(ocrResults);

    this.uiLog.log(`Cloud AI: Enriched text length: ${enrichedText.length}`);

    // Step 2: Extract fields via cloud LLM (no language detection or vocabulary needed)
    this.uiAlert.setLoadingSpinnerMessage(
      this.translate.instant('AI_IMPORT_STEP_ANALYZING'),
    );

    return this.cloudFieldExtraction.extractAllFields(enrichedText);
  }

  /**
   * Run OCR on multiple photos and collect results.
   * Handles errors gracefully, skipping failed photos.
   */
  private async runOcrOnPhotos(
    photoPaths: string[],
  ): Promise<TextDetectionResult[]> {
    const ocrResults: TextDetectionResult[] = [];

    for (let i = 0; i < photoPaths.length; i++) {
      this.uiAlert.setLoadingSpinnerMessage(
        this.translate.instant('AI_IMPORT_MULTI_PROCESSING_PHOTO', {
          current: i + 1,
          total: photoPaths.length,
        }),
      );

      const photoPath = photoPaths[i];
      this.uiLog.log(
        `Cloud AI Multi-photo OCR: Processing photo ${i + 1}/${photoPaths.length}, path: ${photoPath}`,
      );

      let base64: string;
      try {
        base64 = await this.uiFileHelper.readInternalFileAsBase64(photoPath);
        this.uiLog.log(
          `Cloud AI Multi-photo OCR: Photo ${i + 1} read successfully, base64 length: ${base64.length}`,
        );
      } catch (readError: any) {
        this.uiLog.error(
          `Cloud AI Multi-photo OCR: Failed to read photo ${i + 1} at path ${photoPath}: ${readError?.message || readError}`,
        );
        continue;
      }

      if (!base64 || base64.length < 1000) {
        this.uiLog.error(
          `Cloud AI Multi-photo OCR: Photo ${i + 1} has suspiciously short base64 (${base64?.length || 0} chars), skipping`,
        );
        continue;
      }

      try {
        const ocrResult = (await CapacitorPluginMlKitTextRecognition.detectText(
          {
            base64Image: base64,
          },
        )) as TextDetectionResult;

        this.uiLog.log(
          `Cloud AI Multi-photo OCR: Photo ${i + 1} OCR result: ${JSON.stringify(ocrResult).substring(0, 200)}`,
        );

        if (ocrResult.text && ocrResult.text.trim() !== '') {
          ocrResults.push(ocrResult);
          this.uiLog.log(
            `Cloud AI Multi-photo OCR: Photo ${i + 1} extracted ${ocrResult.text.length} chars`,
          );
        } else {
          this.uiLog.log(
            `Cloud AI Multi-photo OCR: Photo ${i + 1} had no text`,
          );
        }
      } catch (ocrError: any) {
        this.uiLog.error(
          `Cloud AI Multi-photo OCR: OCR failed for photo ${i + 1}: ${ocrError?.message || ocrError}`,
        );
        continue;
      }
    }

    return ocrResults;
  }

  /**
   * Clean up temporary photo files
   */
  private async cleanupPhotos(photoPaths: string[]): Promise<void> {
    for (const path of photoPaths) {
      try {
        await this.uiFileHelper.deleteInternalFile(path);
        this.uiLog.log('Cloud AI: Deleted temp photo: ' + path);
      } catch (e) {
        this.uiLog.error('Cloud AI: Failed to delete temp photo: ' + e);
      }
    }
  }
}
